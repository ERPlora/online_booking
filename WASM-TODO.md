# online_booking — Lógica NO-CRUD pendiente (Tier 2: Rust → WASM)

Las tablas, queries y commands
declarativos cubren el CRUD (listar, alta, transiciones simples de estado, soft-delete,
upsert de settings). **Esto** documenta la lógica que NO es expresable en SQL declarativo
y que debe implementarse como handler WASM (Extism) o capacidad de host, según el contrato
de hub (`ARQUITECTURA.md` §5.3). El WASM nunca toca la BD: valida/calcula y devuelve
*intenciones* que el runtime ejecuta. **No** se ha escrito Rust ni `dist/`.

Origen: `models.py`, `services.py` (`BookingService`, `convert_to_target`), `routes.py`.

---

## 1. Generación atómica de `booking_reference` (BK-00001) — ✅ RESUELTO (SQL declarativo)

- **Origen**: `OnlineBooking.generate_reference()` — `SELECT max(booking_reference)` con
 `LIKE 'BK-%'`, parsea el número y devuelve `BK-{n+1:05d}`.
- **Resolución (2026-06-10, issue #1)**: NO hizo falta handler — patrón `sales_sale_counter`
 ("sin read-back desde el guest"): tabla `online_booking_reference_counter` (002), el command
 `bookings.create` ejecuta `commands/_bump_reference.sql` (upsert +1; primera alta siembra
 desde el `max()` de referencias `BK-%` legacy) y `commands/booking_create.sql` lee el
 contador con subquery — todo en la MISMA transacción. El upsert serializa altas concurrentes
 sobre la fila del hub; único e incremental por hub. `printf()` es SQLite (Postgres: `lpad()`).

## 2. Transiciones de estado válidas (invariant) — ✅ RESUELTO (triggers SQL)

- **Origen**: `services._VALID_STATUS_TRANSITIONS` + `update_status`.
 - `confirm`: solo desde `pending`
 - `cancel`: desde `pending` o `confirmed`
 - `complete`: solo desde `confirmed`
 - `no_show`: solo desde `confirmed`
- **Resolución (2026-06-10, issue #2)**: el runtime Rust no tiene registro de invariants y
 los handlers WASM no tienen lecturas de BD, así que el invariant se impone con **triggers**
 `BEFORE UPDATE OF status` + `RAISE(ABORT, '<mensaje legible>')` en la migración
 `003_status_transition_guards.sql` (uno por estado destino; `RAISE()` exige mensaje
 constante). Una transición inválida aborta la transacción y el mensaje llega al caller
 (`{ok:false, error}` → la UI lo muestra en `formError`). Los `WHERE status = ...` de los
 commands se retiraron para que el trigger dispare en vez de un no-op silencioso de 0 filas.
 Si algún día existe el registro de invariants del runtime, puede sustituir a los triggers.

## 3. Validación de fecha/hora futura + reglas de antelación

- **Origen**: `create_booking` — `booking_dt <= now → error` y, conceptualmente, las reglas
 de `min_advance_hours` / `max_advance_days` / `slot_duration_minutes` / `buffer_minutes`
 de `BookingPageSettings`.
- **Por qué no es SQL**: requiere `now()` con timezone, combinar fecha+hora y comparar
 contra los settings del hub.
- **Handler WASM**: `validate_booking_window(settings, booking_date, booking_time, duration)`
 → ok | error. Debe ejecutarse antes de `online_booking.bookings.create`.

## 4. Detección de doble reserva por staff (solapamiento)

- **Origen**: `create_booking` — carga las reservas `pending|confirmed` del mismo
 `staff_name`+`booking_date` y comprueba solapamiento de intervalos
 `[start, start+duration)` con `new_start < ex_end AND new_end > ex_start`.
- **Por qué no es SQL declarativo simple**: aritmética de intervalos (fecha+hora+duración)
 sobre el conjunto de reservas existentes; debe correr dentro de la misma transacción que
 el INSERT para ser correcta.
- **Handler WASM**: recibe las reservas candidatas (vía una query de solo-lectura que el
 runtime le proporciona) + la nueva, calcula solapamiento y devuelve ok | conflicto
 (con la referencia y hora de la reserva en conflicto).

## 5. Singleton de settings: get-or-create con defaults

- **Origen**: `BookingPageSettings.get_settings()` — si no hay fila para el hub, crea una
 con los defaults y la devuelve.
- **Estado en SQL**: `queries/settings_get.sql` devuelve la fila si existe;
 `commands/settings_upsert.sql` hace el INSERT-or-UPDATE (`ON CONFLICT(hub_id)`).
- **Pendiente runtime**: si se necesita "leer-creando" (lectura que materializa defaults),
 el runtime debe hacer el upsert con defaults en el primer acceso. La UI ya degrada
 mostrando los defaults del schema cuando la query viene vacía.

## 6. `convert_to_target` — integración cross-módulo (appointment / table_reservation)

- **Origen**: `services.convert_to_target()` — crea un `Appointment` (módulo `appointments`)
 o `Reservation` (módulo `reservations`) a partir de la reserva, y marca
 `target_type` + `target_id`. Lanza `RuntimeError` si el módulo destino no está instalado.
- **Por qué no es SQL del propio módulo**: escribe en tablas de **otros** módulos. En
 hub esto es **contrato cross-módulo**: debe invocar los commands públicos de los
 módulos destino (p.ej. `appointments.appointments.create` /
 `reservations.reservations.create`), no tocar sus tablas.
- **Dependencias blandas**: `appointments` y `reservations` son opcionales (no van en
 `depends_on`). El handler debe degradar si el módulo destino no está activo.
- **Handler WASM + orquestación de runtime**: validar `booking_type`, mapear campos
 (start/end datetime = `booking_date`+`booking_time`+`duration_minutes`), emitir las
 intenciones de command hacia el módulo destino y luego el UPDATE de `target_type`/
 `target_id` sobre `online_booking_booking`. Falta también el command público
 `online_booking.bookings.convert_to_target` (no incluido aún por depender de la
 resolución cross-módulo).

## 7. Dashboard / estadísticas

- **Origen**: `routes.dashboard()` — `confirmed_today`, `total_this_week`
 (rango `week_start..week_end`), próximas reservas (`today..today+7d`).
- **Por qué se documenta**: son agregados con rangos de fecha calculados respecto a `now()`.
 Pueden resolverse como queries declarativas adicionales con binds de fecha calculados por
 el runtime/UI, o como un handler. No portado en esta primera pasada (el listado + filtros
 cubren el caso de uso principal); pendiente si se requiere la vista dashboard.

---

## Eventos emitidos (contrato)

Declarados en `module.json` (`emit`), consumibles por otros módulos / la UI:
`online_booking.booking.created`, `.confirmed`, `.cancelled`, `.completed`,
`.no_show`, `.deleted`, `online_booking.settings.updated`.
