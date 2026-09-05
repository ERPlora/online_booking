#!/usr/bin/env python3
"""`bookings.create` may not answer ok over a booking it never wrote (online_booking#25).

WHAT WAS WRONG. `bookings.create` ran two statements in one transaction:
`_bump_reference.sql` (an unconditional UPSERT that always affects 1) and `booking_create.sql`
(an `INSERT … SELECT FROM online_booking_settings` whose WHERE — the booking window — can match
zero rows). The `expect_rows {min: 1}` gate weighed the BATCH SUM, so the bump's 1 satisfied the
guard the INSERT had just failed: the command answered `200 ok`, published
`online_booking.booking.created` for a booking that does not exist, AND burned a reference
number. Without a settings row the INSERT selected zero rows for a second reason — the hub has
no booking window to check against — and that case failed the SAME way: silent ok, nothing
written.

THE TWO LAYERS OF THE FIX, and what this battery pins of each:

  1. the gate is ANCHORED to the real INSERT (`expect_rows.statement`, hub#1091), so the bump
     can no longer satisfy it. Pinned here against a REAL Postgres: outside window →
     `online_booking.outside_booking_window` with ZERO rows written and the reference NOT
     burned (the rollback takes the bump with it — the harness weighs the gate inside the
     transaction, the way `execute_tx_gated` does);
  2. a hub WITHOUT a settings row is refused with its own translated code
     (`online_booking.settings_missing`, decided in the WASM handler over a pre-loaded read),
     because "this business never configured its booking window" and "that slot is outside the
     window" are different operating failures and must not share a message. The battery cannot
     run the handler (said out loud, not faked): what it pins is the CONTRACT — the manifest
     wires the handler + the required `settings.get` read, both locales translate the code —
     and the SQL half: without a settings row the INSERT selects zero rows, so even a bypassed
     pre-check cannot commit a phantom ok anymore (the anchored gate refuses and rolls the
     counter back).

Also pinned, because it is the reason the anchor exists: the DOCUMENTED batch-sum semantics
(the shape this command had before the fix) measured over the same no-settings batch — it says
ok. That is the hole, kept as a test so nobody "simplifies" the anchor away.

The handler's own decision (`settings_missing` before any SQL runs) is covered by `cargo test`
in `handler/`; the 409 and the rolled-back outbox are the runtime's own tests (hub#1114).

Usage: tests/create_gate.pg.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ONLINE_BOOKING_TEST_PG_CONTAINER).
"""

import importlib.util
import json
import pathlib
import sys

_HARNESS = pathlib.Path(__file__).resolve().parent / "pg_harness.py"
_spec = importlib.util.spec_from_file_location("pg_harness", _HARNESS)
pg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pg)

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = pg.MANIFEST

failures: list[str] = []


def check(label: str, expected, actual) -> None:
    if expected != actual:
        failures.append(f"{label} — expected {expected!r}, got {actual!r}")
        print(f"  FAIL: {label} — expected {expected!r}, got {actual!r}")
    else:
        print(f"  ok: {label} = {actual!r}")


def check_true(label: str, cond: bool) -> None:
    check(label, True, bool(cond))


def payload(date: str, time_: str = "15:00:00") -> dict:
    """A booking the schema accepts, in the shape the runtime hands the SQL.

    The dispatcher injects the schema's `default`s into absent keys before the command runs
    (decision-log 2026-06-25); this harness binds absent params as NULL instead, so the battery
    spells the defaulted shape out — the honest way to run the SQL standalone.
    """
    return {
        "customer_id": None,
        "customer_name": "Bar Pepe",
        "customer_email": "pepe@example.com",
        "customer_phone": "+34 600 000 001",
        "service_id": None,
        "service_name": "Mesa terraza",
        "staff_id": None,
        "staff_name": "",
        "booking_date": date,
        "booking_time": time_,
        "duration_minutes": 60,
        "booking_type": "table_reservation",
        "notes": "ventana, por favor",
    }


def create_intent() -> str:
    """The command that carries the create SQL.

    After the fix that is the internal intent `online_booking._booking_create` (the root
    `bookings.create` is a WASM command whose handler refuses `settings_missing` BEFORE any
    SQL and then emits this intent). Before the fix it was the root itself — resolving both
    keeps this battery meaningful against the shape that had the bug.
    """
    internal = "online_booking._booking_create"
    return internal if internal in MANIFEST["commands"] else "online_booking.bookings.create"


def bookings(db, hub=pg.HUB) -> str:
    return db.scalar(
        f"SELECT count(*) FROM online_booking_booking WHERE hub_id = '{hub}' AND is_deleted = 0"
    )


def counter_number(db, hub=pg.HUB) -> str:
    return db.scalar(
        "SELECT COALESCE((SELECT last_number FROM online_booking_reference_counter "
        f"WHERE hub_id = '{hub}'), NULL)::text"
    )


# ── 1. contract: the manifest wires the two layers, and both locales translate the codes ──
print("== contract: manifest + locales ==")


def contract_checks() -> None:
    create = MANIFEST["commands"]["online_booking.bookings.create"]
    check_true(
        "root create delegates to the WASM handler (dist/handler.wasm)",
        create.get("handler", {}).get("type") == "wasm"
        and create.get("handler", {}).get("file") == "dist/handler.wasm"
        and create.get("handler", {}).get("function") == "create_booking",
    )
    reads = create.get("reads", [])
    check_true(
        "root create preloads the settings read, required",
        any(
            r.get("query") == "online_booking.settings.get" and r.get("required")
            for r in reads
        ),
    )

    intent = MANIFEST["commands"].get(create_intent())
    check_true("the create intent exists in the manifest", intent is not None)
    if intent:
        gate = intent.get("expect_rows", {})
        check(
            "the gate is anchored to the real INSERT (hub#1091)",
            "commands/booking_create.sql",
            gate.get("statement"),
        )
        check(
            "outside-window keeps its own code",
            "online_booking.outside_booking_window",
            gate.get("error"),
        )
        check(
            "the anchored batch is [bump, create]",
            ["commands/_bump_reference.sql", "commands/booking_create.sql"],
            intent.get("sql"),
        )

    # ADR-0398 + hub#1570: the key is the COMPLETE code, flat. The hub's SDK indexes first-level
    # `<module>.<snake_case>` keys only (hub#1573), so a bucket grouped by module reads as "nobody
    # translated this" and a Spanish till keeps the server's English.
    for code in ("online_booking.settings_missing", "online_booking.outside_booking_window"):
        check_true(f"module.json declares {code}", code in (MANIFEST.get("errors") or {}))
        for locale in ("en", "es"):
            cat = json.loads((MODULE_DIR / "locales" / f"{locale}.json").read_text())
            text = (cat.get("errors") or {}).get(code)
            check_true(
                f"{locale} translates {code}", isinstance(text, str) and bool(text.strip())
            )


contract_checks()

# ── 2. against a REAL Postgres ────────────────────────────────────────────────────────────
if not pg.container_available():
    # Column 0 on purpose: the shared gate reads this as "the whole battery skipped".
    print("SKIPPED: the test Postgres container is not running")
    sys.exit(0 if len(failures) == 0 else 1)

db = pg.ScratchDb("ob25")
db.create()
try:
    # ── happy path: settings + a date inside the window → row, BK-00001, counter at 1 ──
    print("== happy path ==")
    pg.seed_settings(db)
    counts = db.run_command(create_intent(), payload("2026-08-23"))  # +27h: inside 2h..30d
    check("both statements of the happy path write", [1, 1], counts)
    check("one booking row", "1", bookings(db))
    check("reference is BK-00001", "BK-00001", db.scalar(
        "SELECT booking_reference FROM online_booking_booking WHERE hub_id = 'hub-under-test'"
    ))
    check("counter at 1", "1", counter_number(db))

    # ── outside the window (too far): the anchored gate refuses AND the rollback is whole ──
    print("== outside window (too far) ==")
    try:
        db.run_command(create_intent(), payload("2026-10-22"))  # +61 days > max 30
        check_true("a too-far booking is rejected", False)
    except pg.CommandRejected as rej:
        check("too-far rejection code", "online_booking.outside_booking_window", rej.code)
        check("the anchored statement is the one that weighed 0", [1, 0], rej.counts)
    check("still one booking row (no phantom)", "1", bookings(db))
    check(
        "the reference was NOT burned by the refusal (rollback took the bump)",
        "1",
        counter_number(db),
    )

    # ── outside the window (too soon): same gate, the *24 half of the arithmetic ──
    print("== outside window (too soon) ==")
    try:
        db.run_command(create_intent(), payload("2026-08-22", "12:30:00"))  # +30min < 2h
        check_true("a too-soon booking is rejected", False)
    except pg.CommandRejected as rej:
        check("too-soon rejection code", "online_booking.outside_booking_window", rej.code)
    check("still one booking row", "1", bookings(db))
    check("reference still not burned", "1", counter_number(db))

    # ── the next booking that fits takes the number the refusals did not burn ──
    print("== numbering survives the refusals ==")
    db.run_command(create_intent(), payload("2026-08-24"))
    check("the second accepted booking is BK-00002, not a number burned by a refusal", "BK-00002", db.scalar(
        "SELECT booking_reference FROM online_booking_booking "
        "WHERE hub_id = 'hub-under-test' AND booking_date = '2026-08-24'"
    ))

    # ── no settings row: the INSERT cannot even be evaluated — and cannot commit ok either ──
    print("== hub without a settings row ==")
    db.exec_script("DELETE FROM online_booking_settings")
    db.exec_script("DELETE FROM online_booking_booking")
    db.exec_script("DELETE FROM online_booking_reference_counter")

    # The SQL half, measured: `FROM online_booking_settings WHERE …` selects the row it joins
    # on; with no settings row there is nothing to join against and the INSERT writes zero —
    # the reason the refusal cannot live in the WHERE alone (online_booking#25) and lives in the
    # handler's pre-check, with `settings_missing` as its own translated code. The counter is
    # seeded by hand so the only thing missing is the settings row — otherwise the reference
    # subquery would be the statement's reason for failing, which is not what is measured here.
    db.exec_script(
        f"INSERT INTO online_booking_reference_counter (id, hub_id, last_number) "
        f"VALUES ('ctr-1', '{pg.HUB}', 1);"
    )
    stmt = pg.bind(
        (MODULE_DIR / "commands" / "booking_create.sql").read_text(),
        {"hub_id": pg.HUB, "new_id": "b-1", "now": pg.NOW, "current_user_id": pg.USER,
         "booking_id": "b-1", **payload("2026-08-23")},
    ).strip().rstrip(";")
    db.psql([], db=db.name, stdin=f"BEGIN;\n{stmt};\nCOMMIT;")
    check(
        "booking_create.sql alone writes 0 rows without a settings row",
        "0",
        db.scalar(
            f"SELECT count(*) FROM online_booking_booking WHERE hub_id = '{pg.HUB}'"
        ),
    )

    # And even if the handler's pre-check were bypassed, the anchored gate refuses and the
    # whole batch — bump included — rolls back: no silent ok, no burned number. The counter
    # stays at its seeded 1: the increment the bump made was part of the rolled-back batch.
    try:
        db.run_command(create_intent(), payload("2026-08-23"))
        check_true("a no-settings booking cannot commit ok", False)
    except pg.CommandRejected as rej:
        check(
            "no-settings via SQL only still refuses through the anchored gate",
            "online_booking.outside_booking_window",
            rej.code,
        )
    check("zero booking rows", "0", bookings(db))
    check(
        "no reference burned for a hub that never configured its window",
        "1",
        counter_number(db),
    )

    # ── the measured hole: the batch-sum semantics this command had before the fix ──
    print("== the documented batch-sum hole (why the anchor exists) ==")
    counts = db.run_command(create_intent(), payload("2026-08-23"), gate_mode="batch")
    check(
        "the batch sum says ok over a batch that wrote no booking (the P0, measured)",
        [1, 0],
        counts,
    )
    check(
        "…and it burned a reference for nothing — what the anchor stops",
        "2",
        counter_number(db),
    )
finally:
    db.drop()

print()
if failures:
    print(f"BATTERY FAILED: {len(failures)} check(s)")
    sys.exit(1)
print("BATTERY PASSED")
