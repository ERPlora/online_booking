-- Alta de reserva online. Sentencia ANCLADA de `online_booking._booking_create` (la intención
-- que emite el handler de `bookings.create`): runtime inyecta :hub_id, :current_user_id, :now,
-- :new_id (para el contador); :booking_id lo elige el handler desde el batch de ids del host.
-- Portado de BookingService.create_booking.
-- booking_reference (BK-00001) se calcula leyendo el contador del hub — recién
-- incrementado por commands/_bump_reference.sql, primera op de la intención — en la MISMA
-- transacción: atómico y único por hub sin handler (patrón sales_sale_counter).
-- Padding portable: erp_pad(valor, ancho) (ADR-0007) → printf/lpad por dialecto en el shim.
--
-- VENTANA DE RESERVA (online_booking#10): la impone el WHERE de este SELECT — fecha futura +
-- min_advance_hours/max_advance_days de los ajustes del NEGOCIO — y la gate
-- `expect_rows {statement: "commands/booking_create.sql"}` (hub#1091) la convierte en rechazo.
-- El ANCLA es lo que cierra online_booking#25: sin ella la gate pesaba la SUMA del lote y el
-- UPSERT del contador (siempre 1 fila) satisfacía la guarda que el INSERT acababa de fallar —
-- 200 ok, reserva sin escribir, referencia quemada. Con el ancla, sólo este INSERT cuenta: si
-- no casa, el lote ENTERO revierte (contador incluido) y el llamante recibe
-- `online_booking.outside_booking_window`.
--
-- El caso «hub SIN fila de ajustes» no pasa por aquí: lo rechaza el handler de
-- `bookings.create` con `online_booking.settings_missing` ANTES de emitir la intención (ver
-- handler/src/lib.rs) — sin fila de ajustes no hay ventana que aplicar, y ese fallo de operar
-- merece su propio mensaje, no el de «fuera de ventana». El FROM settings de abajo queda como
-- red de seguridad ante la carrera (ajustes borrados entre la lectura del handler y esta
-- escritura): en esa ventana mínima el INSERT no casa y la gate anclada revierte.
INSERT INTO online_booking_booking
  (id, hub_id, booking_reference, customer_id, customer_name, customer_email,
   customer_phone, service_id, service_name, staff_id, staff_name,
   booking_date, booking_time, duration_minutes, status, booking_type,
   notes, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT
  :booking_id, :hub_id,
  'BK-' || erp_pad((
  SELECT last_number FROM online_booking_reference_counter WHERE hub_id = :hub_id
  ), 5),
  :customer_id, :customer_name, :customer_email,
  :customer_phone, :service_id, :service_name, :staff_id, :staff_name,
  :booking_date, :booking_time, :duration_minutes, 'pending', :booking_type,
  :notes, 0, :current_user_id, :current_user_id, :now, :now
FROM online_booking_settings st
WHERE st.hub_id = :hub_id
  AND st.is_deleted = 0
  -- VENTANA DE RESERVA (online_booking#10). Los números son del NEGOCIO, no constantes: salen de
  -- `online_booking_settings`. Y se miden contra `:now`, el reloj del servidor — nunca contra una
  -- fecha que mande el llamante, que es justo lo que un canal público puede falsear.
  --
  -- `erp_datediff_days` devuelve la diferencia FRACCIONARIA en días, así que ×24 son las horas de
  -- antelación sin necesidad de otro helper.
  AND erp_datediff_days(erp_dt(:booking_date || 'T' || :booking_time), erp_dt(:now)) * 24
      >= st.min_advance_hours
  AND erp_datediff_days(erp_dt(:booking_date || 'T' || :booking_time), erp_dt(:now))
      <= st.max_advance_days;
