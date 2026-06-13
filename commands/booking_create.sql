-- Alta de reserva online. Runtime inyecta :new_id, :hub_id, :current_user_id, :now.
-- Portado de BookingService.create_booking.
-- booking_reference (BK-00001) se calcula leyendo el contador del hub — recién
-- incrementado por commands/_bump_reference.sql, primera op del command — en la MISMA
-- transacción: atómico y único por hub sin handler (patrón sales_sale_counter).
-- printf() es de SQLite; Postgres usaría lpad() (portabilidad SQL §14).
-- La ventana de reserva (fecha futura + min_advance_hours/max_advance_days/slot) la
-- imponen los triggers BEFORE INSERT de la migración 004; la doble reserva por staff,
-- el trigger de la 005 — ver WASM-TODO.md §3/§4.
INSERT INTO online_booking_booking
  (id, hub_id, booking_reference, customer_id, customer_name, customer_email,
   customer_phone, service_id, service_name, staff_id, staff_name,
   booking_date, booking_time, duration_minutes, status, booking_type,
   notes, is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id,
   'BK-' || printf('%05d', (
       SELECT last_number FROM online_booking_reference_counter WHERE hub_id = :hub_id
   )),
   :customer_id, :customer_name, :customer_email,
   :customer_phone, :service_id, :service_name, :staff_id, :staff_name,
   :booking_date, :booking_time, :duration_minutes, 'pending', :booking_type,
   :notes, 0, :current_user_id, :current_user_id, :now, :now);
