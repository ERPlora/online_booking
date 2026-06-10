-- Contador atómico de booking_reference por hub (BK-00001, BK-00002, …).
-- Mismo patrón que sales_sale_counter: el command `online_booking.bookings.create`
-- hace el upsert (+1) y el INSERT de la reserva lee el contador con una subquery
-- en la MISMA transacción — sin read-back, sin carrera (el upsert serializa a los
-- escritores concurrentes sobre la fila del hub). Ver WASM-TODO.md §1.
CREATE TABLE IF NOT EXISTS online_booking_reference_counter (
    id          TEXT PRIMARY KEY,
    hub_id      TEXT NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_ob_refcounter_hub ON online_booking_reference_counter (hub_id);
