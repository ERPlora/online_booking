# Online Booking — Limits and troubleshooting

## Known limitations you should know about

- **No conversion command.** A booking is never turned into an appointment or a table reservation
  automatically; there is no command for it.
- **No availability check at all.** Only the booking window is enforced. Double bookings are
  possible and nothing warns you.
- **Nothing is sent to the customer.** No confirmation, no reminder, no cancellation notice.
- **No payment or deposit.**
- **No external calendar sync.**
- **No scheduled tasks.** Nothing expires a stale `pending` booking.

## Errors you will actually see

Every one of these **rolls the transaction back** — no row change, no event.

| Error | What happened | What to do |
|---|---|---|
| `online_booking.outside_booking_window` | The date and time are too soon or too far ahead | Adjust the date, or the advance settings |
| `online_booking.cannot_confirm` | The booking is no longer `pending` | Re-read it; it may already be confirmed |
| `online_booking.cannot_complete` | It was never confirmed | Confirm it first |
| `online_booking.cannot_cancel` | It is already `completed` or `cancelled` | Nothing to cancel |
| `online_booking.cannot_mark_no_show` | Its state does not allow it | Check the state |

## Required fields

| Action | Must provide |
|---|---|
| Create a booking | `customer_name`, `service_name`, `booking_date`, `booking_time` |
| Confirm / cancel / complete / no-show / delete | `booking_id` |
| Save the settings | nothing is strictly required |

## Accepted values

| Field | Values |
|---|---|
| Status | `pending`, `confirmed`, `cancelled`, `completed`, `no_show` |
| Booking type | `appointment` (default), `table_reservation` |
| Date | `YYYY-MM-DD` |
| Time | `HH:MM:SS` |

## Defaults and caps

| Setting | Default |
|---|---|
| Minimum advance hours | 2 |
| Maximum advance days | 30 |
| Slot duration minutes | 30 |

| Limit | Value |
|---|---|
| Rows per page (bookings) | 50 |
| Maximum rows a paginated request may ask for | 500 |
| Settings rows per hub | 1 |
| Reference counter | one per hub |

## Permissions per action

| To do this | You need |
|---|---|
| See bookings and the settings | `online_booking.view_booking` |
| Take a booking, cancel, complete, mark a no-show | `online_booking.change_booking` |
| **Confirm** a booking | `online_booking.confirm_booking` |
| Delete a booking | `online_booking.delete_booking` |
| Save the settings | `online_booking.manage_settings` |

By role: **admin** has everything. **manager** can view, change and confirm — but **cannot delete a
booking or change the settings**. **employee** is **read-only** and cannot even take a booking.

Note that confirming is its own permission, separate from changing.

## Dependencies — what breaks if something is missing

**`customers` is required** and installed with the module, but the reference is by contract with the
name copied — the booking is readable regardless.

**`appointments` and `reservations` are soft dependencies**: they are where a booking is meant to end
up, but neither is declared, neither is required, and **neither is called**. Installing them changes
nothing about how this module behaves.

**Nothing depends on Online Booking.** Its events are published for anybody who wants them; no
consumer is declared.

## When something looks wrong

**"The booking was refused as outside the window."** Check the **minimum advance hours** and
**maximum advance days** in the settings. The check uses the **server clock**, so a date sent in the
payload cannot get around it.

**"Two customers booked the same time."** Expected. This module checks no availability at all. The
real slot is held by `appointments` or `reservations`, and only once somebody creates it there.

**"I confirmed a booking and no appointment appeared."** There is no conversion. Create the
appointment or reservation by hand.

**"The customer never got a confirmation email."** Nothing is sent. The confirmation message in the
settings is text for the page, not an email.

**"I cannot complete this booking."** It must be `confirmed` first.

**"I cannot confirm it a second time."** Correct — it is no longer pending, and the refusal exists so
the event is not emitted twice.

**"An employee cannot take a booking."** Correct. `online_booking.change_booking` is a manager
permission; an employee can only view.

**"Two bookings share a reference."** They cannot; the counter is bumped in the same transaction as
the insert.

**"Old `pending` bookings pile up."** Nothing expires them. Cancel them by hand.

**"The service name on an old booking is out of date."** The name is a copy taken when the booking
was made. That is deliberate — it survives the service being renamed or the module being removed.
