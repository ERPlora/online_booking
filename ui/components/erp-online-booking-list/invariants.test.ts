// The invariants this module promises but never had (online_booking#10).
//
// `003_status_transition_guards.sql` and `004_booking_window_guards.sql` are, to this day, files
// with **zero statements**: only a comment saying the guards were written as SQLite triggers and
// that in cloud they were "redundant defence in depth, because the runtime validates the same write
// at origin (local-first, ADR-0031)".
//
// Both halves of that sentence stopped being true:
//   * **SQLite is gone** (ADR-0154) — so the guards do not live anywhere, not just "not in Postgres";
//   * **there is no cloud copy and no sync** (ADR-0040/0154), so "at origin" is this database;
//   * and the runtime did NOT validate the same write: the four transition commands were bare
//     `UPDATE … WHERE id = :booking_id`, with no previous state at all. A cancelled booking could be
//     completed, a completed one cancelled, anything could jump anywhere.
//
// The file names promised a lock that was not there. This pins the real one — and it lives where
// this codebase puts invariants: in the command, not in a trigger. That way it applies to every
// caller of the dispatcher, including the public API.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'module.json'), 'utf8')) as {
  id: string;
  commands: Record<string, { sql?: string[]; expect_rows?: { op: string; n: number; error: string; message?: string; statement?: string } }>;
};

const sqlOf = (rel: string) =>
  readFileSync(join(ROOT, rel), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

const cmdSql = (name: string) => (manifest.commands[name].sql ?? []).map(sqlOf).join('\n');

const TRANSITIONS = ['confirm', 'cancel', 'complete', 'no_show'] as const;
const full = (t: string) => `online_booking.bookings.${t}`;

describe('a booking cannot jump to any state from any state', () => {
  it.each(TRANSITIONS)('%s only applies from the states that admit it', (t) => {
    expect(
      cmdSql(full(t)),
      `${t} updates the row whatever state it was in: a cancelled booking could be ${t}ed`,
    ).toMatch(/\bAND\s+status\s*(?:=|\bIN\b|\bNOT\s+IN\b)/i);
  });

  it.each(TRANSITIONS)('%s fails instead of reporting success over nothing', (t) => {
    const gate = manifest.commands[full(t)].expect_rows;
    expect(gate, `${t} would emit its event even when it changes nothing`).toBeTruthy();
    expect(gate!.op).toBe('min');
    expect(gate!.n).toBeGreaterThanOrEqual(1);
    expect(gate!.error.split('.')[0]).toBe(manifest.id);
    expect(gate!.message).toBeTruthy();
  });
});

// The window is not decoration: it is what stops a customer booking for yesterday, for ten minutes
// from now, or for next year. The numbers belong to the business (`online_booking_settings`), so the
// guard reads them instead of hardcoding any.
//
// Since online_booking#25 the create SQL lives in the internal intent `online_booking._booking_create`
// (the root `bookings.create` is a WASM command: it refuses a hub with no settings row BEFORE any SQL
// and then emits that intent) — so that is the command these pins read.
describe('a booking has to fall inside the window the business configured', () => {
  const create = () => cmdSql('online_booking._booking_create');

  it('reads the window from the settings of this hub, not from constants', () => {
    const sql = create();
    expect(sql, 'the create never looks at the settings').toMatch(/online_booking_settings/);
    expect(sql).toMatch(/hub_id\s*=\s*:hub_id/);
    for (const setting of ['min_advance_hours', 'max_advance_days']) {
      expect(sql, `the window ignores ${setting}`).toMatch(new RegExp(setting));
    }
  });

  it('compares against the server clock, never against a date the caller sent', () => {
    expect(create(), 'the window must be measured from :now, which the runtime injects').toMatch(/:now/);
  });

  it('refuses instead of writing a booking outside the window', () => {
    const gate = manifest.commands['online_booking._booking_create'].expect_rows;
    expect(gate, 'a conditional INSERT with no gate writes nothing and still reports a booking').toBeTruthy();
    expect(gate!.error.split('.')[0]).toBe(manifest.id);
    expect(gate!.message).toBeTruthy();
  });
});

// online_booking#25: the counter UPSERT of the same op affects ALWAYS one row, so a gate weighing the
// batch SUM is satisfied by the very batch that failed — `200 ok`, no booking written, reference
// number burned. The anchor (`expect_rows.statement`, hub#1091) is what ties the gate to the INSERT.
describe('the create gate counts the INSERT, not the batch', () => {
  const root = () =>
    manifest.commands['online_booking.bookings.create'] as unknown as {
      handler?: { type: string; function: string };
      reads?: { query: string; required: boolean }[];
    };

  it('anchors the gate to the real INSERT (hub#1091)', () => {
    const gate = manifest.commands['online_booking._booking_create'].expect_rows!;
    expect(gate.statement, 'without the anchor the counter UPSERT neutralizes the gate').toBe(
      'commands/booking_create.sql',
    );
    expect(manifest.commands['online_booking._booking_create'].sql).toContain(gate.statement);
  });

  it('refuses a hub with no settings row before any SQL runs, with its own code', () => {
    const create = root();
    expect(create.handler?.function, 'the settings pre-check lives in the WASM handler').toBe('create_booking');
    expect(
      create.reads?.some((r) => r.query === 'online_booking.settings.get' && r.required),
      'the handler decides over a pre-loaded read, never over a guess',
    ).toBe(true);
    // The key is the COMPLETE code, flat: the hub's SDK indexes first-level `<module>.<snake_case>`
    // keys only (hub#1570/#1573), so a bucket grouped by module reads as "nobody translated this".
    for (const locale of ['en', 'es'] as const) {
      const errors = JSON.parse(readFileSync(join(ROOT, 'locales', `${locale}.json`), 'utf8')).errors;
      for (const code of ['online_booking.settings_missing', 'online_booking.outside_booking_window']) {
        expect(errors[code], `${locale} must translate ${code}`).toBeTruthy();
      }
    }
  });
});

describe('the migrations no longer promise a lock they do not have', () => {
  it.each([
    'migrations/postgres/003_status_transition_guards.sql',
    'migrations/postgres/004_booking_window_guards.sql',
  ])('%s says where the guard actually lives', (file) => {
    const raw = readFileSync(join(ROOT, file), 'utf8');
    // Naming the dead justification is fine — explaining WHY it died is the point of the file.
    // What must not survive is the claim that the guard is redundant, or still owed to somebody.
    expect(raw, 'still calls the missing guard "redundant defence in depth"').not.toMatch(/redundante/i);
    expect(raw, 'still parks the guard as pending work').not.toMatch(/PENDIENTE|no-op portable/i);
    expect(raw, 'a file named «guards» has to say where the guard IS').toMatch(/expect_rows/);
  });
});
