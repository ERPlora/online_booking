UPDATE online_booking_booking
   SET customer_id = :surviving_id,
       updated_by  = :current_user_id,
       updated_at  = :now
 WHERE hub_id = :hub_id
   AND customer_id = :absorbed_id
   AND CAST(:surviving_id AS TEXT) <> CAST(:absorbed_id AS TEXT);

-- Online booking · `customer.merged` — re-point a merged customer's online bookings to the
-- survivor (customers#86/customers#87).
--
-- Runs from the outbox relay: the payload IS the emitter's params (`surviving_id`, `absorbed_id`,
-- `hub_id`), so there is no `schema` on the command.
--
-- The `hub_id` guard is load-bearing: `customer_id` is an opaque id with no cross-module foreign
-- key, and the same string may name a different person in another hub.
--
-- ALL rows move — live and soft-deleted, any status — because this is the customer's history, not
-- a view of it. `customer_name`/`customer_email`/`customer_phone` are a snapshot of how the
-- booking was made and are deliberately NOT touched.
--
-- No unique index in this module includes `customer_id`, so this blind re-point cannot collide.
-- It never reads `customers`, so it does not require the absorbed sheet to still exist.
--
-- The surviving<>absorbed guard turns a degenerate event into a no-op instead of re-stamping rows
-- that are already correct.
--
-- IDEMPOTENT: the outbox is at-least-once, so a redelivery matches zero rows. No `expect_rows`:
-- merging a customer who never booked online is the ordinary case.
