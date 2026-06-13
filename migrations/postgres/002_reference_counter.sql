-- Online_booking · esquema inicial (Postgres / Aurora cloud). Equivalente a
-- migrations/sqlite/002_reference_counter.sql — mismas tablas, índices, FK y contrato de fila del
-- hub (§2.5): hub_id + soft-delete + auditoría. Generado por paridad mecánica.
--
-- Tipos: subconjunto portable "ERPlora SQL" (ADR-0007):
--   * ids/refs → TEXT (UUIDs del runtime como texto);
--   * flags 0/1 → INTEGER (los commands bindean 0/1; Postgres no castea entero→bool);
--   * importes → NUMERIC;
--   * FECHAS → TEXT ISO-8601 (NO TIMESTAMPTZ): el motor de sync (ADR-0031) compara
--     updated_at como string lexicográfico; timestamptz rompería el LWW entre dialectos.

CREATE TABLE IF NOT EXISTS online_booking_reference_counter (
    id          TEXT PRIMARY KEY,
    hub_id      TEXT NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_ob_refcounter_hub ON online_booking_reference_counter (hub_id);