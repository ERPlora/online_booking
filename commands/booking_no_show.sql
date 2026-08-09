-- Marcar una reserva como no-show. Portado de OnlineBooking.mark_no_show + update_status.
-- Transición válida ('confirmed' -> 'no_show') impuesta por el trigger
-- trg_ob_status_no_show_guard (003_status_transition_guards.sql): una transición
-- inválida aborta con error legible en vez de no afectar filas en silencio.
UPDATE online_booking_booking
SET status = 'no_show',
    updated_by = :current_user_id,
    updated_at = :now
-- El «no se presentó» solo tiene sentido antes de completar: sobre una reserva ya completada o
-- cancelada es reescribir el pasado (online_booking#10).
WHERE id = :booking_id AND hub_id = :hub_id AND is_deleted = 0
  AND status IN ('pending', 'confirmed');
