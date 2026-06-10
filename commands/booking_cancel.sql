-- Cancelar una reserva (pending o confirmed). Portado de OnlineBooking.cancel + update_status.
-- La transición válida ('pending'|'confirmed' -> 'cancelled') la impone el trigger
-- trg_ob_status_cancel_guard (003_status_transition_guards.sql): una transición
-- inválida aborta con error legible en vez de no afectar filas en silencio.
UPDATE online_booking_booking
SET status = 'cancelled',
    cancelled_at = :now,
    cancellation_reason = :reason,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :booking_id AND hub_id = :hub_id AND is_deleted = 0;
