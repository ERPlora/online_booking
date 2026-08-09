-- Alta de reserva online. Runtime inyecta :new_id, :hub_id, :current_user_id, :now.
-- Portado de BookingService.create_booking.
-- booking_reference (BK-00001) se calcula leyendo el contador del hub — recién
-- incrementado por commands/_bump_reference.sql, primera op del command — en la MISMA
-- transacción: atómico y único por hub sin handler (patrón sales_sale_counter).
-- Padding portable: erp_pad(valor, ancho) (ADR-0007) → printf/lpad por dialecto en el shim.
-- La ventana de reserva (fecha futura + min_advance_hours/max_advance_days/slot) la
-- imponen los triggers BEFORE INSERT de la migración 004; la doble reserva por staff,
-- el trigger de la 005 — ver WASM-TODO.md §3/§4.
INSERT INTO online_booking_booking
  (id, hub_id, booking_reference, customer_id, customer_name, customer_email,
   customer_phone, service_id, service_name, staff_id, staff_name,
   booking_date, booking_time, duration_minutes, status, booking_type,
   notes, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT
  :new_id, :hub_id,
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
