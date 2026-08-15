# Online Booking — Screens

The module contributes two tabs to the hub navigation: **Bookings** and **Settings**.

## Bookings

Every online booking in the hub (`online_booking.bookings.list`, 50 rows per page). Requires
`online_booking.view_booking` — an employee can read this.

Open one for its detail (`online_booking.bookings.get`): the reference, the customer, the service,
the professional, the date and time, the status and the notes.

Each booking stores the ids of the customer, the service and the professional **with their names
copied alongside**, so the row stays readable even if those modules are not loaded.

### Take a booking

1. Enter the **customer name**, the **service name**, the **booking date** and the **booking time** —
   those four are required.
2. Optionally add the customer, service and professional ids, contact details and notes.
3. Save.

The booking is created `pending` and gets its reference `BK-00001`.

**The booking window is enforced here**: the date and time must be at least the configured minimum
hours ahead and no more than the configured maximum days ahead, measured against the **server
clock**. Outside that, the write is refused with `online_booking.outside_booking_window` and nothing
is created.

Requires `online_booking.change_booking` — an employee **cannot** take a booking.

### Confirm a booking

Only from `pending`. Requires `online_booking.confirm_booking`, which is a separate permission from
changing a booking.

### Complete a booking

Only from `confirmed` — you cannot complete something that was never confirmed. Requires
`online_booking.change_booking`.

### Cancel a booking

Allowed from anything that is not already `cancelled` or `completed`. Requires
`online_booking.change_booking`.

### Mark a no-show

Allowed from `pending` or `confirmed`. Requires `online_booking.change_booking`.

### Delete a booking

Destructive and **admin only** (`online_booking.delete_booking`). Prefer cancelling — it keeps the
record.

## Settings — the public booking page

The configuration of the page customers see. Viewing needs `online_booking.view_booking`; saving
needs `online_booking.manage_settings` — **admin only**.

| Setting | What it controls | Default |
|---|---|---|
| **Enabled** | Whether the public page is on | — |
| Page title, welcome message | What the page says | — |
| Primary colour, logo | How it looks | — |
| Require phone / require email | Mandatory contact fields | — |
| Allow staff selection | Whether the customer picks a professional | — |
| Allow notes | Whether the customer can leave a comment | — |
| **Minimum advance hours** | How soon before the slot a booking is still accepted | 2 |
| **Maximum advance days** | How far ahead a booking is accepted | 30 |
| Slot duration minutes | The step between offered times | 30 |
| Buffer minutes | Padding around a booking | — |
| Confirmation message, cancellation policy | Text shown to the customer | — |

The two advance settings are the ones with teeth: they are what the booking window check reads.

If no settings row exists, the defaults above apply.

## What happens after a booking arrives

Nothing automatic. A booking sits in this list until somebody acts on it:

1. **Confirm** it, so the customer knows it is accepted.
2. **Create the real appointment or table reservation by hand** in `appointments` or `reservations` —
   there is no conversion command.
3. **Complete** it after the service, or mark a **no-show**.

Nothing is emailed to the customer at any point in that sequence.
