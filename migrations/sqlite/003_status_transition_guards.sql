-- Invariants de transición de estado (WASM-TODO.md §2, portado de
-- services._VALID_STATUS_TRANSITIONS):
--   confirm:  solo desde 'pending'
--   cancel:   desde 'pending' o 'confirmed'
--   complete: solo desde 'confirmed'
--   no_show:  solo desde 'confirmed'
-- Una transición inválida debe devolver un ERROR legible, no un no-op silencioso.
-- Se aplica con triggers BEFORE UPDATE OF status + RAISE(ABORT, …): corren dentro de la
-- misma transacción del command, abortan el UPDATE y el mensaje llega al caller (la UI
-- lo muestra). Los commands de transición ya NO llevan guard de status en el WHERE —
-- el trigger es la única autoridad de la transición. RAISE() exige mensaje constante
-- (SQLite), por eso hay un trigger por estado destino con su mensaje específico.

CREATE TRIGGER IF NOT EXISTS trg_ob_status_confirm_guard
BEFORE UPDATE OF status ON online_booking_booking
FOR EACH ROW
WHEN NEW.status = 'confirmed' AND OLD.status <> 'pending'
BEGIN
    SELECT RAISE(ABORT, 'Cannot confirm a booking that is not pending');
END;

CREATE TRIGGER IF NOT EXISTS trg_ob_status_cancel_guard
BEFORE UPDATE OF status ON online_booking_booking
FOR EACH ROW
WHEN NEW.status = 'cancelled' AND OLD.status NOT IN ('pending', 'confirmed')
BEGIN
    SELECT RAISE(ABORT, 'Cannot cancel a booking that is not pending or confirmed');
END;

CREATE TRIGGER IF NOT EXISTS trg_ob_status_complete_guard
BEFORE UPDATE OF status ON online_booking_booking
FOR EACH ROW
WHEN NEW.status = 'completed' AND OLD.status <> 'confirmed'
BEGIN
    SELECT RAISE(ABORT, 'Cannot complete a booking that is not confirmed');
END;

CREATE TRIGGER IF NOT EXISTS trg_ob_status_no_show_guard
BEFORE UPDATE OF status ON online_booking_booking
FOR EACH ROW
WHEN NEW.status = 'no_show' AND OLD.status <> 'confirmed'
BEGIN
    SELECT RAISE(ABORT, 'Cannot mark as no-show a booking that is not confirmed');
END;
