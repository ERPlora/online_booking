-- Marcar una reserva como completada. Portado de OnlineBooking.complete + update_status.
-- Transición válida ('confirmed' -> 'completed') impuesta por el trigger
-- trg_ob_status_complete_guard (003_status_transition_guards.sql): una transición
-- inválida aborta con error legible en vez de no afectar filas en silencio.
UPDATE online_booking_booking
SET status = 'completed',
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :booking_id AND hub_id = :hub_id AND is_deleted = 0;
