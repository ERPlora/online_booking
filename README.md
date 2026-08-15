# Módulo `online_booking` — canal de reservas online

**Canal de entrada** de reservas (desde la página pública o a mano): registra cada una con su
referencia `BK-00001` y su máquina de estados (`pending → confirmed → completed`, más
`cancelled`/`no_show`), aplica la **ventana de reserva** y guarda la configuración de la página
pública.

> ⚠️ **Es un CANAL, no una agenda.** Aquí no se comprueba disponibilidad ninguna: ni agenda de
> profesional, ni aforo de mesa, ni solapes. Lo único que se valida es la ventana de reserva. La
> franja real la sostienen `appointments` o `reservations`.

<!-- -->

> 🔴 **La conversión NO está implementada.** No existe command que convierta una reserva en cita o
> en reserva de mesa: la reserva lleva `booking_type` y campos de destino, pero **nadie los rellena**.
> Tras confirmar hay que crear la cita/reserva **a mano**.

<!-- -->

> **Module id:** `online_booking`. **Depende de:** `customers` (por contrato, **sin FK**, con el
> nombre denormalizado). Dependencias **blandas** no declaradas: `appointments`, `reservations`.
> Módulo declarativo (SQL); el WASM está planificado y **no escrito**.

## Documentación de usuario — [`docs/`](docs/)

Viaja **dentro** del módulo y se versiona con él: el asistente del hub (ADR-0282) la indexa por
versión instalada y cita la de TU versión, no la de la última publicada. En inglés (idioma fuente).

| Fichero | Para qué |
| ------- | -------- |
| [`docs/overview.md`](docs/overview.md) | Qué hace y qué NO hace; canal vs agenda vs sala |
| [`docs/screens.md`](docs/screens.md) | Bookings y Settings: tomar, confirmar, completar, no-show y qué pasa DESPUÉS |
| [`docs/concepts.md`](docs/concepts.md) | Una reserva es una **petición**, no una franja; la ventana se mide contra el **reloj del SERVIDOR**; los triggers que documentaba el arch doc **nunca existieron** |
| [`docs/limits.md`](docs/limits.md) | Los 5 códigos de dominio, permisos por acción y por qué se pueden duplicar reservas |

## Qué expone hoy

| Tipo | Nombre | Permiso |
| ---- | ------ | ------- |
| query | `online_booking.bookings.list` / `.get` · `.settings.get` | `view_booking` |
| command | `online_booking.bookings.create` (→ `outside_booking_window`) / `.cancel` / `.complete` / `.no_show` | `change_booking` |
| command | `online_booking.bookings.confirm` (permiso PROPIO) | `confirm_booking` |
| command | `online_booking.bookings.delete` | `delete_booking` (solo admin) |
| command | `online_booking.settings.upsert` | `manage_settings` (solo admin) |
| emite | `online_booking.booking.created/confirmed/cancelled/completed/no_show/deleted`, `.settings.updated` | — |
| escucha | — | — |

Navegación: `erp-online-booking-list` («Bookings») y `erp-online-booking-settings` («Settings»).

## Layout

```text
module.json                   # manifest (contrato técnico)
migrations/postgres/          # esquema §2.5 + contador de referencias por hub
queries/*.sql                 # lecturas declarativas (:hub_id inyectado)
commands/*.sql                # escrituras declarativas, cada transición condicionada por el estado previo
schemas/*.json                # JSON Schemas de input (draft 2020-12)
ui/                           # Web Components (Lit/Ionic/OutfitKit)
docs/                         # documentación de usuario + corpus del asistente
```

## Estado y trabajo abierto

El estado vive en las **Issues de este repo**, no aquí. Limitaciones documentadas en
`docs/limits.md`: sin `convert_to_target`, **sin comprobación de disponibilidad**, **cero envíos** al
cliente, sin tareas programadas que caduquen una `pending` vieja, y sin sync de calendario (lo
ownaría `calendar_sync`, ADR-0148 — el cliente final **nunca necesita cuenta de Google**: `.ics` o
enlace «añadir al calendario»).

Doc de arquitectura: `architecture/modules/online_booking.md` (cargarlo antes de tocar el módulo).
