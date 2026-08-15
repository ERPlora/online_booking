# Online Booking — Concepts

The things people get wrong on their first day.

## A booking here is a request, not a slot

Nothing is reserved by taking a booking. No professional's diary is blocked, no table is held, no
capacity is consumed anywhere.

Until somebody creates the corresponding appointment or table reservation, **two customers can book
the same time** and nothing will complain. That is not a bug in this module; it is what "intake
channel" means.

## The conversion does not exist yet

A booking carries a **type** (`appointment` or `table_reservation`) and fields for its target, but
**there is no command that converts it**. Nothing calls `appointments` or `reservations`.

Practical consequence: after confirming a booking, somebody must create the real appointment or
reservation by hand. If you assumed the modules were wired together, they are not.

## The only rule enforced is the booking window

Creating a booking checks exactly one thing: that the date and time are

- at least **minimum advance hours** away, and
- no more than **maximum advance days** away.

Both are measured against the **server clock** — never against a date supplied in the request, which
is what stops somebody backdating a booking to slip past the window.

Outside the window the write is refused and **nothing is created**. Inside it, anything goes.

## Every status transition is guarded and returns a real error

| Action | Allowed from | Refusal |
|---|---|---|
| Confirm | `pending` | `online_booking.cannot_confirm` |
| Complete | `confirmed` | `online_booking.cannot_complete` |
| Cancel | anything except `cancelled` and `completed` | `online_booking.cannot_cancel` |
| No-show | `pending`, `confirmed` | `online_booking.cannot_mark_no_show` |

A refused transition **rolls the transaction back** — no row change, no event.

Note that cancellation is defined by what it **rejects**, not by what it accepts: everything is
cancellable until it is finished.

> Worth knowing if you read old documentation: this used to be described as enforced by database
> triggers. **Those triggers never existed in Postgres** — they were written for a database engine
> that was retired, and their migration files were empty, so for months there was no guard anywhere.
> The guards now live in the commands themselves.

## Completing requires confirming first

There is no shortcut from `pending` to `completed`. A booking nobody accepted cannot be marked as
served.

## Cancel, no-show and delete are three different things

- **Cancel** — it will not happen, and you keep the record.
- **No-show** — it was accepted and the customer never came. That is the data you need to spot a
  pattern.
- **Delete** — the row goes. Destructive and admin-only.

In day-to-day work you cancel.

## Confirming has its own permission

`online_booking.confirm_booking` is separate from `online_booking.change_booking`. Somebody can be
allowed to accept bookings without being allowed to cancel or complete them, and vice versa.

An **employee has neither** — an employee can only look.

## The customer, service and professional are copies, not links

Each is stored as an id **without a foreign key**, with the name copied onto the booking. That is
deliberate resilience: the booking stays readable when the other module is not installed, and a
booking taken from a public page does not require a customer record to exist.

The cost is the usual one: renaming a service elsewhere does not update bookings already taken.

## References are allocated atomically

`BK-00001` comes from a per-hub counter bumped in the same transaction as the insert, so simultaneous
bookings cannot share a reference. On the first booking the counter seeds itself from the highest
existing reference, so legacy data does not collide.

## Nothing is ever sent to the customer

The settings hold a confirmation message and a cancellation policy, and the page can require an email
address. **No email, SMS or WhatsApp is sent by this module** — not on booking, not on confirmation,
not as a reminder.

## External calendars are somebody else's job, and the customer never needs a Google account

There is no external calendar id on a booking, on purpose. A satellite module listens to the events
this one already emits.

Worth knowing for the customer-facing side: the design is an **`.ics` file** or an
"add to calendar" link — neither requires the customer to log in to anything, and reminders would come
from ERPlora, not from a calendar provider.

## Dates and times are plain values

`YYYY-MM-DD` and `HH:MM:SS`, with no timezone. The server clock is the reference for the window
check.

## Deleting is a soft delete

Bookings are marked deleted, not erased.
