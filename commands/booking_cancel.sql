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
-- Se cancela cualquier cosa que no haya terminado ya. Se define por lo que RECHAZA: una reserva
-- completada o ya cancelada no se vuelve a cancelar (online_booking#10).
WHERE id = :booking_id AND hub_id = :hub_id AND is_deleted = 0
  AND status NOT IN ('cancelled', 'completed');
