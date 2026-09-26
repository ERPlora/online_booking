# Online Booking — Overview

## What this module does

Online Booking is the **channel** through which bookings arrive — from a public booking page, or
entered by hand. It records each booking with a reference and a state machine (pending, confirmed,
completed, cancelled, no-show), enforces the booking window the business allows, and holds the
configuration of the public page: its title, its colours, what the customer must provide and how far
ahead they may book.

## It is a channel, not a diary and not a dining room

Three modules book time and they do different jobs:

| Module | Owns |
|---|---|
| **Online Booking** | The **intake channel** and the public page |
| **Appointments** | The real diary — availability, professionals, overlap |
| **Reservations** | Table bookings — slot capacity, waitlist |

A booking taken here is meant to be **converted** into an appointment or a table reservation. Until
it is, it is a request, not a slot anybody is holding.

> ⚠️ **The conversion is not implemented.** There is no command to convert a booking into an
> appointment or a table reservation. A booking carries fields for the target, but nothing fills
> them. Treat bookings as records to act on manually.

## What this module does NOT do

- **It does not check availability.** No professional's diary, no table capacity, no overlap. The
  only thing it enforces is the booking window.
- **It does not convert a booking into anything.** See above.
- **It does not send anything.** No confirmation email, no reminder — the settings carry the text,
  nothing delivers it.
- **It does not serve the public page.** It holds its configuration.
- **It does not take payment or a deposit.**
- **It does not sync with an external calendar.**

## Modules it connects to

**Depends on `customers`**, referenced by contract with the id stored and the name copied — **no
foreign key**.

**Soft dependencies, not declared**: `appointments` and `reservations` are where a booking is meant to
end up, but neither is required and neither is called today.

**Events it emits**

| Event | When |
|---|---|
| `online_booking.booking.created` | a booking is taken |
| `online_booking.booking.confirmed` | it is confirmed |
| `online_booking.booking.cancelled` | it is cancelled |
| `online_booking.booking.completed` | it is completed |
| `online_booking.booking.no_show` | the customer did not come |
| `online_booking.booking.deleted` | it is deleted |
| `online_booking.settings.updated` | the settings are saved |

**Events it listens to**

| Event | What it does |
|---|---|
| `customer.merged` | when two customer sheets are merged, every online booking of the absorbed sheet (live or deleted, any status) moves to the surviving one, in this hub only; the name, email and phone copied at booking time stay as they were (customers#86) |

## The lifecycle

```
pending ──▶ confirmed ──▶ completed
   └────────────┴──▶ cancelled / no_show
```

Every transition is guarded and returns a domain error when it does not apply.

## Where its numbers come from

- **Booking references** are `BK-00001`, from an atomic per-hub counter allocated in the same
  transaction as the booking.
- **Dates** are `YYYY-MM-DD` and **times** are `HH:MM:SS`.
- **The booking window** is measured against the **server clock**, never a date supplied in the
  request.

## Booking types

`appointment` (the default) or `table_reservation`. This says what the booking is *meant to become*;
it does not create anything.
