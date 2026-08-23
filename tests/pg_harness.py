"""Shared plumbing for this module's Postgres batteries — the runtime dispatcher, in miniature.

Runs the manifest's OWN SQL against a REAL Postgres 18 (the workspace's `erplora-test-pg-5433`
container), building a scratch database from this module's own migrations and DROPPING it at the
end, pass or fail. Same shape as the harness `tickets`, `services`, `staff` and `schedules`
carry — copied rather than invented so a reader who knows one knows all of them.

What is reproduced of the dispatcher, and only that:

  * `:name` placeholders bound as literals in ONE pass (a value carrying a colon — an ISO
    timestamp — is never rescanned; `::` casts are never binds);
  * the `erp_*` bridge functions rewritten to native Postgres exactly the way
    `hub/crates/db/src/lib.rs` rewrites them (`erp_pad` → `lpad`, `erp_dt` → `::timestamptz`,
    `erp_datediff_days` → `EXTRACT(EPOCH FROM …) / 86400.0`);
  * params absent from the payload bind as NULL (`DynNull`, `hub/crates/db/src/lib.rs`);
  * a command's `sql[]` runs inside ONE transaction with the system params (`hub_id`,
    `current_user_id`, `now`, one `new_id` for the whole batch — the runtime binds `system_params`
    ONCE and clones it per statement) injected;
  * the **affected-rows gate** is evaluated INSIDE the transaction, the way
    `execute_tx_gated` does it — and that includes hub#1091: when the manifest declares
    `expect_rows.statement`, only THAT statement's count weighs; without the anchor, the
    batch SUM is the contract (the documented semantics, kept). A gate that fails aborts the
    whole transaction — nothing lands, not even the statement that ran before the guarded one —
    which is the property `online_booking#25` is about: a refused booking must not burn a
    reference number.

What is NOT reproduced, said out loud instead of faked:

  * JSON Schema validation of the payload (that is a contract battery's job);
  * the WASM handler half of `bookings.create`. The manifest wires the pre-check
    (`reads` + `dist/handler.wasm`); the DECISION lives in `handler/src/lib.rs` and is covered
    by `cargo test` there. What this harness CAN run is the internal intent the handler emits
    (`online_booking._booking_create`) — the SQL and the gate the runtime would execute for it;
  * the transactional outbox — no `_event_outbox` table exists here. What the batteries CAN pin
    is the gate that decides whether the runtime ever gets to write one: below the minimum the
    whole transaction rolls back, outbox included, so "the gate rejected" is exactly "no event
    was emitted". `CommandRejected` is that verdict.
"""

import json
import os
import pathlib
import re
import subprocess
import uuid

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get(
    "ONLINE_BOOKING_TEST_PG_CONTAINER",
    os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433"),
)
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

HUB = "hub-under-test"
OTHER_HUB = "hub-next-door"
USER = "u-owner"
#: Fixed clock. The window cases must not depend on the real one (same rule as every harness).
NOW = "2026-08-22T12:00:00Z"

PARAM = re.compile(r"(?<!:):([a-z_][a-z0-9_]*)", re.IGNORECASE)


class CommandRejected(RuntimeError):
    """The manifest's `expect_rows` gate refused the mutation — HTTP 409 with a stable code.

    In the runtime the transaction has already rolled back when this is raised; in this harness
    the DO block that raised it aborted the transaction the same way, so "rejected" and "nothing
    landed" are the same statement here too.
    """

    def __init__(self, code: str, counts: list[int], expected: int):
        super().__init__(f"{code} (per-statement counts {counts}, expected at least {expected})")
        self.code = code
        self.counts = counts
        self.expected = expected


def container_available() -> bool:
    try:
        subprocess.run(
            ["docker", "inspect", CONTAINER], capture_output=True, check=True, text=True
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _scan_call(sql: str, open_idx: int) -> tuple[list[str], int] | None:
    """Balanced-paren scan of the argument list starting AT `(`; top-level commas split args.

    A regex cannot do this: `erp_pad((SELECT last_number FROM …), 5)` carries parens inside its
    first argument. The runtime scans the same way (`scan_call_args`,
    `hub/crates/db/src/lib.rs`).
    """
    depth = 0
    args: list[str] = []
    start = open_idx + 1
    for i in range(open_idx, len(sql)):
        c = sql[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                args.append(sql[start:i])
                return args, i + 1
        elif c == "," and depth == 1:
            args.append(sql[start:i])
            start = i + 1
    return None


def _render_bridge(name: str, args: list[str]) -> str | None:
    """The renderings of `render_bridge_fn` (hub/crates/db/src/lib.rs), one per bridge used."""
    a = [x.strip() for x in args]
    if name == "erp_pad" and len(a) == 2:
        return f"lpad(({a[0]})::text, {a[1]}, '0')"
    if name == "erp_dt" and len(a) == 1:
        return f"(({a[0]})::timestamptz)"
    if name == "erp_datediff_days" and len(a) == 2:
        return f"(EXTRACT(EPOCH FROM (({a[0]})::timestamptz - ({a[1]})::timestamptz)) / 86400.0)"
    return None


def bridge(sql: str) -> str:
    """The bridge functions these statements use, rewritten like the runtime does.

    Balanced-paren scanning, recursive (an argument may contain another bridge call), applied
    until no bridge name remains — the same contract as `shim_functions`. Renderings copied
    from `render_bridge_fn` in `hub/crates/db/src/lib.rs`: a miniature that invents its own
    dialect would test the miniature, not the module.
    """
    names = ("erp_pad", "erp_dt", "erp_datediff_days")
    changed = True
    while changed:
        changed = False
        for name in names:
            at = sql.find(name + "(")
            while at != -1:
                # `xerp_pad(` must not match: the char before the name must not be wordy.
                before = sql[at - 1] if at > 0 else ""
                if before.isalnum() or before == "_":
                    at = sql.find(name + "(", at + 1)
                    continue
                call = _scan_call(sql, at + len(name))
                if call is None:
                    break
                args, end = call
                rendered = _render_bridge(name, args)
                if rendered is None:
                    raise RuntimeError(f"bridge {name} with args {args!r} cannot be rendered")
                sql = sql[:at] + rendered + sql[end:]
                changed = True
                at = sql.find(name + "(", at + len(rendered))
    return sql


def bind(sql: str, params: dict) -> str:
    return PARAM.sub(lambda m: literal(params.get(m.group(1))), bridge(sql))


class ScratchDb:
    """A throwaway database built from the manifest's Postgres migrations."""

    def __init__(self, prefix: str):
        self.name = f"{prefix}_{os.getpid()}_{uuid.uuid4().hex[:6]}"

    def psql(
        self, args: list[str], db: str | None = None, stdin: str | None = None, check: bool = True
    ) -> subprocess.CompletedProcess:
        cmd = [
            "docker",
            "exec",
            "-i",
            CONTAINER,
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            "-X",
        ]
        if db:
            cmd += ["-d", db]
        cmd += args
        res = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
        if check and res.returncode != 0:
            raise RuntimeError(res.stderr.strip() or res.stdout.strip())
        return res

    def create(self) -> None:
        self.psql(["-c", f'DROP DATABASE IF EXISTS "{self.name}"'])
        self.psql(["-c", f'CREATE DATABASE "{self.name}"'])
        for rel in MANIFEST["migrations"]["postgres"]:
            self.psql([], db=self.name, stdin=(MODULE_DIR / rel).read_text())

    def drop(self) -> None:
        try:
            self.psql(["-c", f'DROP DATABASE IF EXISTS "{self.name}" WITH (FORCE)'], check=False)
        except RuntimeError as exc:
            print(f"  ! could not drop {self.name}: {exc}")

    def scalar(self, sql: str) -> str:
        return self.psql(["-tAc", sql], db=self.name).stdout.strip()

    def exec_script(self, sql: str) -> None:
        self.psql([], db=self.name, stdin=sql)

    def run_command(self, name: str, payload: dict, hub: str = HUB, gate_mode: str = "manifest") -> list[int]:
        """Execute a manifest command's `sql[]` as the runtime does, and apply its `expect_rows`.

        The gate is weighed INSIDE the transaction (a plpgsql DO block that tracks `ROW_COUNT`
        per statement and raises `GATE:<code>` when the minimum is not met), so a refused
        command leaves NOTHING behind — the rollback semantics of `execute_tx_gated`, which is
        the property being pinned (online_booking#25: a refused booking must not burn a
        reference).

        `gate_mode`: `"manifest"` honors the gate exactly as declared — including the
        `expect_rows.statement` anchor of hub#1091, where only the anchored statement's count
        weighs. `"batch"` ignores the anchor and weighs the batch SUM, which is the DOCUMENTED
        default semantics and the shape this module carried before online_booking#25: it exists
        so the battery can measure the hole (an unconditional sibling statement satisfying the
        guard) instead of merely describing it.

        Returns the per-statement affected counts. Raises `CommandRejected` when the gate the
        manifest declares did not clear — which is where the runtime answers 409 and writes no
        event.
        """
        cmd = MANIFEST["commands"][name]
        params = dict(payload)
        params.setdefault("hub_id", hub)
        params.setdefault("current_user_id", USER)
        params.setdefault("now", NOW)
        # One `new_id` for the whole batch: the runtime binds `system_params` once and clones
        # the bound params per statement — the booking row and the counter seed share it, which
        # is fine (different tables). `booking_id` is the id the HANDLER picked from the host's
        # batch (`new_ids[0]`) and passed in the intent params — reproduced here for the same
        # reason: the row's id must be the one the command's response reports.
        params.setdefault("new_id", str(uuid.uuid4()))
        params.setdefault("booking_id", str(uuid.uuid4()))

        stmts = [bind((MODULE_DIR / rel).read_text(), params).strip().rstrip(";")
                 for rel in cmd["sql"]]

        gate = cmd.get("expect_rows")
        guard = ""
        if gate:
            if gate.get("statement") and gate_mode == "manifest":
                # hub#1091: the anchor names the ONLY statement that weighs.
                idx = cmd["sql"].index(gate["statement"])
                cond = f"counts[{idx + 1}] < {gate['n']}"
            else:
                summed = " + ".join(f"counts[{i + 1}]" for i in range(len(stmts)))
                cond = f"({summed}) < {gate['n']}"
            guard = (
                f"IF {cond} THEN RAISE EXCEPTION 'GATE:% (per-statement counts %)', "
                f"'{gate['error']}', counts; END IF;"
            )
        body = "\n".join(
            f"{stmt};\nGET DIAGNOSTICS n = ROW_COUNT; counts[{i + 1}] := n;"
            for i, stmt in enumerate(stmts)
        )
        script = (
            "BEGIN;\n"
            "CREATE TEMP TABLE ob_gate_counts (ord INT, n INT);\n"
            f"DO $gate$\nDECLARE n INTEGER; counts INTEGER[] := ARRAY[{','.join('-1' for _ in stmts)}];\n"
            f"BEGIN\n{body}\n{guard}\n"
            "INSERT INTO ob_gate_counts SELECT t.ord, t.val FROM unnest(counts) WITH ORDINALITY AS t(val, ord);\n"
            "END\n$gate$;\n"
            "COMMIT;\n"
            "SELECT n FROM ob_gate_counts ORDER BY ord;\n"  # same session → the temp table lives
        )
        res = self.psql([], db=self.name, stdin=script, check=False)
        if res.returncode != 0:
            m = re.search(r"GATE:([a-z0-9_.]+)", res.stderr)
            if m:
                # The DO block aborted → the transaction rolled back. The counts it carried in
                # the message are diagnostics only; nothing they describe landed.
                c = re.search(r"counts \{([^}]*)\}", res.stderr)
                counts = [int(x) for x in c.group(1).split(",")] if c else []
                raise CommandRejected(m.group(1), counts, gate["n"] if gate else 0)
            raise RuntimeError(res.stderr.strip() or res.stdout.strip())
        rows = [line for line in res.stdout.splitlines() if line.strip().lstrip("-").isdigit()]
        return [int(x) for x in rows]


def seed_settings(
    db: ScratchDb,
    *,
    hub: str = HUB,
    min_advance_hours: int = 2,
    max_advance_days: int = 30,
    enabled: int = 1,
) -> None:
    """One settings row, straight in — the fixture, not the thing under test."""
    db.exec_script(
        "INSERT INTO online_booking_settings (id, hub_id, is_enabled, min_advance_hours, "
        "max_advance_days, is_deleted, created_at, updated_at) VALUES ("
        f"'st-{hub}', {literal(hub)}, {enabled}, {min_advance_hours}, {max_advance_days}, "
        f"0, {literal(NOW)}, {literal(NOW)});"
    )
