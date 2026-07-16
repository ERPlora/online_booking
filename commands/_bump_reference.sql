-- PG-compat (auditoría pm#16, 07-17): columna CUALIFICADA en DO UPDATE — sin cualificar
-- es AMBIGUA en Postgres (error de parseo; SQLite lo tolera). Mismo bug que mató la agenda
-- de appointments en Hub Cloud (appointments#19).
-- Incrementa atómicamente el contador de booking_reference del hub (upsert).
-- Primera op de `online_booking.bookings.create` (misma transacción que el INSERT).
-- En la primera alta se siembra desde el max() de las referencias BK-% ya existentes
-- (migración desde datos legacy); después el ON CONFLICT serializa los +1 concurrentes.
-- Runtime inyecta :new_id y :hub_id.
INSERT INTO online_booking_reference_counter (id, hub_id, last_number)
VALUES (
    :new_id,
    :hub_id,
    COALESCE((
        SELECT max(CAST(substr(booking_reference, 4) AS INTEGER))
        FROM online_booking_booking
        WHERE hub_id = :hub_id AND booking_reference LIKE 'BK-%'
    ), 0) + 1
)
ON CONFLICT (hub_id) DO UPDATE SET last_number = online_booking_reference_counter.last_number + 1;
