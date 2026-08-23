-- Incrementa atómicamente el contador de booking_reference del hub (upsert).
-- Primera op de `online_booking._booking_create`, la intención que emite el handler de
-- `bookings.create` (misma transacción que el INSERT de la reserva).
-- En la primera alta se siembra desde el max() de las referencias BK-% ya existentes
-- (migración desde datos legacy); después el ON CONFLICT serializa los +1 concurrentes.
-- Runtime inyecta :new_id y :hub_id.
-- OJO (online_booking#25): este UPSERT afecta SIEMPRE 1 fila; por eso la gate del command va
-- ANCLADA al INSERT (`expect_rows.statement`, hub#1091). Sin ancla, la suma del lote hacía que
-- este 1 tapara al 0 del INSERT y el command contestaba ok sin escribir nada — quemando además
-- el número de referencia. Con el ancla, si el INSERT no casa, el lote entero revierte y el
-- bump de arriba se lo lleva por delante: una reserva rechazada NO quema hueco.
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
-- `online_booking_reference_counter.last_number`, CUALIFICADO. Sin la tabla delante, Postgres no
-- sabe si el `last_number` de la derecha es el de la fila existente o el de la propuesta y aborta
-- con «column reference "last_number" is ambiguous» — o sea que **crear una reserva fallaba
-- entero**, porque el bump va en la misma transacción que el INSERT. Con SQLite no se notaba;
-- desde ADR-0154 Postgres es el único dialecto (pm#16).
ON CONFLICT (hub_id) DO UPDATE
    SET last_number = online_booking_reference_counter.last_number + 1;
