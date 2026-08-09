-- Confirmar una reserva pendiente. Portado de OnlineBooking.confirm + update_status.
-- La transición válida (solo 'pending' -> 'confirmed') la impone el trigger
-- trg_ob_status_confirm_guard (003_status_transition_guards.sql): una transición
-- inválida aborta con error legible en vez de no afectar filas en silencio.
UPDATE online_booking_booking
SET status = 'confirmed',
    confirmed_at = :now,
    updated_by = :current_user_id,
    updated_at = :now
-- Solo se confirma lo que está PENDIENTE. Confirmar dos veces, o confirmar algo ya cancelado,
-- no es una operación: es un error del llamante (online_booking#10).
WHERE id = :booking_id AND hub_id = :hub_id AND is_deleted = 0
  AND status = 'pending';
