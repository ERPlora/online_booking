#!/usr/bin/env python3
"""customers#86 (online_booking layer) — when two customer sheets are merged, the online bookings follow the survivor.

`customers.merge` retires the absorbed sheet (soft delete) and publishes `customer.merged` with
`{surviving_id, absorbed_id, hub_id}` (customers#87). `online_booking` stores the customer as an
OPAQUE id in `online_booking_booking`, so unless this module re-points it, the survivor's history
misses every booking made online under the duplicate sheet.

WHAT IS PROVEN HERE, against a REAL Postgres:

  1. The manifest listens to `customer.merged` with an internal, transactional command that emits
     nothing and has no `expect_rows` (merging a customer who never booked online is the ordinary case).
  2. Bookings — live and soft-deleted, any status — move to the survivor; the customer snapshot
     (name, email, phone) is left as it was booked.
  3. It does not require the absorbed sheet to exist: no `customers` table in this database.
  4. Bookings of other customers, and anonymous bookings without a customer, are untouched.
  5. IDEMPOTENCE — the outbox is at-least-once; a redelivery changes nothing (not even updated_at).
  6. A degenerate event (`surviving_id = absorbed_id`) is a no-op.
  7. TENANCY — bookings of the hub next door carrying the absorbed id (or the survivor's) are NOT
     re-pointed: an opaque id has no cross-module foreign key, the same string may name someone else.

Runs the SQL the way the runtime does (`:name` bound). Uses `erplora-test-pg-5433` (override:
ERPLORA_TEST_PG_CONTAINER); scratch DB dropped at the end. Missing Docker = SKIPPED, never PASS.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
EVENT = "customer.merged"
LISTENER = "online_booking._on_customer_merged"
HUB = "hub-test"
OTHER_HUB = "hub-other"
SURVIVOR = "cust-ana"
ABSORBED = "cust-ana-dup"
CREATED = "2026-08-01T00:00:00+00:00"
NOW = "2026-09-26T10:00:00+00:00"
LATER = "2026-09-26T11:00:00+00:00"

failures: list[str] = []


def check(label, expected, actual):
    if expected != actual:
        failures.append(f"{label} — expected [{expected}], got [{actual}]")
        print(f"  FAIL: {label} — expected [{expected}], got [{actual}]")
    else:
        print(f"  ok: {label} = {expected}")


def psql(db, sql):
    r = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db,
         "-v", "ON_ERROR_STOP=1", "-q", "-X", "-tA"],
        input=sql,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout


def literal(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


PARAM = re.compile(r"(?<!:):([a-z_][a-z0-9_]*)")  # `::` is a cast, never a bind


def merge(db, hub=HUB, surviving=SURVIVOR, absorbed=ABSORBED, now=NOW):
    """Deliver `customer.merged` the way the outbox relay does: the payload IS the emitter's params."""
    cmd = MANIFEST["commands"][LISTENER]
    params = {
        "surviving_id": surviving,
        "absorbed_id": absorbed,
        "hub_id": hub,
        "current_user_id": "user-merger",
        "now": now,
    }
    script = ["BEGIN;"]
    for rel in cmd["sql"]:
        script.append(
            PARAM.sub(lambda m: literal(params.get(m.group(1))), (MODULE_DIR / rel).read_text())
        )
    script.append("COMMIT;")
    psql(db, "\n".join(script))


def booking(db, bid, hub, customer, status="confirmed", deleted=0, name="Ana"):
    psql(
        db,
        "INSERT INTO online_booking_booking (id, hub_id, booking_reference, customer_id, customer_name, "
        "customer_email, customer_phone, service_name, booking_date, booking_time, status, "
        f"is_deleted, created_at) VALUES ({literal(bid)}, {literal(hub)}, {literal('BK-' + bid)}, "
        f"{literal(customer)}, {literal(name)}, 'ana@example.com', '600000000', 'Haircut', "
        f"'2026-10-01', '10:00:00', {literal(status)}, {deleted}, '{CREATED}')",
    )


def row(db, bid) -> dict:
    out = psql(
        db,
        "SELECT row_to_json(r) FROM (SELECT customer_id, customer_name, customer_email, customer_phone, "
        f"updated_by, updated_at FROM online_booking_booking WHERE id = '{bid}') r;",
    )
    return json.loads(out.strip()) if out.strip() else {}


def fingerprint(db, hub) -> str:
    """Every booking of one hub, in a byte-stable order (COLLATE "C", not the locale)."""
    return psql(
        db,
        "SELECT COALESCE(string_agg(x, '|' ORDER BY x COLLATE \"C\"), '') FROM ("
        " SELECT id || ':' || COALESCE(customer_id, '-') || ':' || COALESCE(updated_by, '-') || ':'"
        " || COALESCE(updated_at, '-') AS x"
        f"   FROM online_booking_booking WHERE hub_id = '{hub}') t;",
    ).strip()


def manifest_half():
    print("== the manifest declares the ear ==")
    listen = MANIFEST["events"].get("listen", {})
    check(f"`{EVENT}` is listened to", LISTENER, (listen.get(EVENT) or {}).get("command"))
    cmd = MANIFEST["commands"].get(LISTENER)
    check(f"`{LISTENER}` exists", True, cmd is not None)
    if cmd is None:
        return False
    check("it is internal (leading `_`)", True, LISTENER.rsplit(".", 1)[1].startswith("_"))
    check("it is transactional", True, cmd.get("transaction"))
    check("it carries SQL", True, bool(cmd.get("sql")))
    check("it emits nothing", None, cmd.get("emit"))
    check("it has no expect_rows (a customer without online bookings is normal)", None, cmd.get("expect_rows"))
    declared = {p if isinstance(p, str) else p.get("codename") for p in MANIFEST.get("permissions", [])}
    check("its permission is declared by the module", True, cmd.get("permission") in declared)
    return True


def main() -> int:
    wired = manifest_half()
    ready = subprocess.run(
        ["docker", "exec", CONTAINER, "pg_isready", "-U", "postgres"], capture_output=True, text=True
    )
    if ready.returncode != 0:
        print(f"SKIPPED: no Postgres in container {CONTAINER} (the SQL half was not verified)")
        return 1 if failures else 0
    if not wired:
        print(f"\nFAILED — {len(failures)} assertion(s)")
        return 1

    db = f"online_booking_merge_{uuid.uuid4().hex[:8]}"
    subprocess.run(["docker", "exec", CONTAINER, "createdb", "-U", "postgres", db], check=True)
    try:
        for rel in [e if isinstance(e, str) else e["file"] for e in MANIFEST["migrations"]["postgres"]]:
            psql(db, (MODULE_DIR / rel).read_text())

        # This hub: the survivor booked once; the duplicate sheet booked online under another spelling.
        booking(db, "b-surv", HUB, SURVIVOR)
        booking(db, "b-abs-live", HUB, ABSORBED, status="pending", name="ana garcia")
        booking(db, "b-abs-done", HUB, ABSORBED, status="completed")
        booking(db, "b-abs-deleted", HUB, ABSORBED, status="cancelled", deleted=1)
        booking(db, "b-someone", HUB, "cust-luis")
        booking(db, "b-anonymous", HUB, None)
        # The hub next door: the SAME opaque ids name other people there.
        booking(db, "n-abs", OTHER_HUB, ABSORBED)
        booking(db, "n-abs-deleted", OTHER_HUB, ABSORBED, deleted=1)
        booking(db, "n-surv", OTHER_HUB, SURVIVOR)
        neighbour_before = fingerprint(db, OTHER_HUB)
        check("no `customers` table here: the listener cannot depend on the absorbed sheet",
              "", psql(db, "SELECT to_regclass('customers_customer');").strip())

        print("\n== the bookings follow the survivor ==")
        merge(db)
        for bid in ("b-abs-live", "b-abs-done", "b-abs-deleted"):
            r = row(db, bid)
            check(f"{bid} now belongs to the survivor", SURVIVOR, r.get("customer_id"))
            check(f"{bid} stamps updated_at with the server clock", NOW, r.get("updated_at"))
            check(f"{bid} stamps who merged", "user-merger", r.get("updated_by"))
        live = row(db, "b-abs-live")
        check("the customer snapshot is kept as it was booked",
              ("ana garcia", "ana@example.com", "600000000"),
              (live.get("customer_name"), live.get("customer_email"), live.get("customer_phone")))
        check("the survivor's own booking is untouched", None, row(db, "b-surv").get("updated_at"))
        check("another customer's booking is untouched", ("cust-luis", None),
              tuple(row(db, "b-someone").get(k) for k in ("customer_id", "updated_at")))
        check("an anonymous booking stays without customer", (None, None),
              tuple(row(db, "b-anonymous").get(k) for k in ("customer_id", "updated_at")))
        check("nothing is left on the absorbed id in this hub", "0", psql(
            db,
            f"SELECT count(*) FROM online_booking_booking WHERE hub_id = '{HUB}' AND customer_id = '{ABSORBED}';",
        ).strip())

        print("\n== tenancy: the hub next door is not touched ==")
        check("hub B rows pointing at the absorbed id are NOT re-pointed", neighbour_before,
              fingerprint(db, OTHER_HUB))

        print("\n== idempotent: a redelivery changes nothing ==")
        after_first = fingerprint(db, HUB)
        merge(db, now=LATER)
        check("a second delivery moves nothing and stamps nothing", after_first, fingerprint(db, HUB))

        print("\n== a degenerate event (surviving = absorbed) is a no-op ==")
        merge(db, surviving=SURVIVOR, absorbed=SURVIVOR, now=LATER)
        check("the survivor's rows are not re-stamped", after_first, fingerprint(db, HUB))
    finally:
        subprocess.run(["docker", "exec", CONTAINER, "dropdb", "-U", "postgres", "--force", db])

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — a merged customer keeps every online booking (customers#86)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
