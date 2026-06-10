-- Confirmar una reserva pendiente. Portado de OnlineBooking.confirm + update_status.
-- La transición válida (solo 'pending' -> 'confirmed') la impone el trigger
-- trg_ob_status_confirm_guard (003_status_transition_guards.sql): una transición
-- inválida aborta con error legible en vez de no afectar filas en silencio.
UPDATE online_booking_booking
SET status = 'confirmed',
    confirmed_at = :now,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :booking_id AND hub_id = :hub_id AND is_deleted = 0;
