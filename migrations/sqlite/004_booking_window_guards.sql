-- Ventana de reserva (WASM-TODO.md §3, issue #3): fecha/hora futura + reglas de
-- antelación de `online_booking_settings` (min_advance_hours / max_advance_days /
-- slot_duration_minutes). El contrato del handler WASM (Tier 2) sigue sin lecturas
-- de BD — el guest no puede cargar los settings del hub — así que, como en 003, la
-- regla se impone con triggers BEFORE INSERT + RAISE(ABORT, …) dentro de la MISMA
-- transacción del command `online_booking.bookings.create`:
--   · sin fila de settings aplican los defaults del producto (COALESCE 2h / 30d / 30min),
--     los mismos del DDL de 001 y del schema de settings;
--   · "ahora" = datetime('now','localtime'): booking_date/booking_time son hora de pared
--     del negocio y el producto primario es local-first (single+Tauri). En despliegues
--     cloud el contenedor debería llevar la TZ del hub;
--   · slot: la hora debe caer en un múltiplo de slot_duration_minutes desde medianoche
--     (los settings no guardan horario de apertura; es el único ancla disponible);
--   · RAISE() exige mensaje constante (SQLite) → un trigger por regla con su mensaje
--     legible. El orden de disparo entre triggers BEFORE INSERT no está definido: si una
--     reserva viola varias reglas, llega el mensaje de cualquiera de ellas.
-- Solo en INSERT: el módulo no tiene command de edición de fecha/hora de una reserva.

-- Formato defensivo: si fecha+hora no parsean, strftime devuelve NULL y ningún otro
-- guard dispararía (WHEN NULL = no fire). El JSON Schema ya valida formato; esto cubre
-- escrituras que no pasen por él.
CREATE TRIGGER IF NOT EXISTS trg_ob_window_datetime_valid_guard
BEFORE INSERT ON online_booking_booking
FOR EACH ROW
WHEN strftime('%s', NEW.booking_date || ' ' || NEW.booking_time) IS NULL
BEGIN
    SELECT RAISE(ABORT, 'Invalid booking date/time format');
END;

CREATE TRIGGER IF NOT EXISTS trg_ob_window_future_guard
BEFORE INSERT ON online_booking_booking
FOR EACH ROW
WHEN CAST(strftime('%s', NEW.booking_date || ' ' || NEW.booking_time) AS INTEGER)
     <= CAST(strftime('%s', datetime('now', 'localtime')) AS INTEGER)
BEGIN
    SELECT RAISE(ABORT, 'Booking date/time must be in the future');
END;

CREATE TRIGGER IF NOT EXISTS trg_ob_window_min_advance_guard
BEFORE INSERT ON online_booking_booking
FOR EACH ROW
WHEN CAST(strftime('%s', NEW.booking_date || ' ' || NEW.booking_time) AS INTEGER)
     < CAST(strftime('%s', datetime('now', 'localtime')) AS INTEGER)
       + COALESCE((SELECT min_advance_hours FROM online_booking_settings
                   WHERE hub_id = NEW.hub_id AND is_deleted = 0), 2) * 3600
BEGIN
    SELECT RAISE(ABORT, 'Booking does not respect the configured minimum advance time');
END;

CREATE TRIGGER IF NOT EXISTS trg_ob_window_max_advance_guard
BEFORE INSERT ON online_booking_booking
FOR EACH ROW
WHEN CAST(strftime('%s', NEW.booking_date || ' ' || NEW.booking_time) AS INTEGER)
     > CAST(strftime('%s', datetime('now', 'localtime')) AS INTEGER)
       + COALESCE((SELECT max_advance_days FROM online_booking_settings
                   WHERE hub_id = NEW.hub_id AND is_deleted = 0), 30) * 86400
BEGIN
    SELECT RAISE(ABORT, 'Booking date exceeds the configured maximum advance window');
END;

CREATE TRIGGER IF NOT EXISTS trg_ob_window_slot_guard
BEFORE INSERT ON online_booking_booking
FOR EACH ROW
WHEN COALESCE((SELECT slot_duration_minutes FROM online_booking_settings
               WHERE hub_id = NEW.hub_id AND is_deleted = 0), 30) > 0
 AND (CAST(strftime('%H', NEW.booking_time) AS INTEGER) * 3600
      + CAST(strftime('%M', NEW.booking_time) AS INTEGER) * 60
      + CAST(strftime('%S', NEW.booking_time) AS INTEGER))
     % (COALESCE((SELECT slot_duration_minutes FROM online_booking_settings
                  WHERE hub_id = NEW.hub_id AND is_deleted = 0), 30) * 60) <> 0
BEGIN
    SELECT RAISE(ABORT, 'Booking time does not fall on a slot boundary');
END;
