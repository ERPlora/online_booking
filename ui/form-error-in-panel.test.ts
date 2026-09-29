// pm#513 (out of pm#478) — on a phone, a refused save in Online bookings showed NOTHING: the person
// pressed «Add» in the new-booking panel, or «Save» at the bottom of Settings, and the screen stayed
// as it was.
//
// The refusal did arrive; it was painted in the wrong place. The new-booking form lives in the
// `create` panel of `ok-data-table`, and under 834 px that panel is a FULL-SCREEN sheet
// (`position: fixed; inset: 0`, outfitkit#75). The banner was a child of the PAGE, so on a phone it
// sat under the sheet. Settings is one long form: its banner sits at the top, so at 390 px it was
// scrolled out of sight above the «Save» button that had just been pressed (bench: hub:stable 1.1.30,
// 390 px, ios and md).
//
// The rule, the same one customers#97 / services#115 / inventory#118 / appointments#227 /
// tables#93 / reservations#73 follow:
//
//   · what goes wrong while SAVING a form is painted INSIDE that form and scrolled into view once it
//     has painted — and only once: editing a field afterwards does not yank the sheet back to it
//     (rv-reservations-73);
//   · what goes wrong OUTSIDE the save (a row action, a list that does not load) stays on the PAGE:
//     no panel is open then, and a message inside a closed panel is just as invisible
//     (rv-appointments-227).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataTableShowsLoadError } from '@erplora/module-sdk';

const BOOKING = {
  id: 'b1',
  booking_reference: 'OB-001',
  customer_name: 'Ana',
  customer_email: '',
  customer_phone: '600',
  service_name: 'Corte',
  staff_name: 'Eva',
  booking_date: '2026-07-13',
  booking_time: '10:00:00',
  duration_minutes: 30,
  status: 'pending',
  booking_type: 'appointment',
  notes: '',
};

const REFUSAL = 'A manager has to approve this.';

let refuse: Error | null = null;
/** When set, the next command waits on it: lets a test look at the screen while a save is in flight. */
let hold: Promise<void> | null = null;
let loadFails = false;
/** Every element the component scrolled into view AFTER it had painted itself. Scrolling a banner
 *  that has not rendered yet measures a 0-px box and leaves it half under the tab bar (staff#72). */
let revealed: Element[] = [];

beforeEach(() => {
  refuse = null;
  hold = null;
  loadFails = false;
  revealed = [];
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    if (this.isConnected) revealed.push(this);
  });
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async () => {
      if (loadFails) throw new Error('list down');
      return { rows: [BOOKING], total: 1 };
    },
    command: async () => {
      if (hold) await hold;
      if (refuse) throw refuse;
      return {};
    },
    on: () => () => {},
    locale: 'es',
    t: (_c: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> } & Record<string, any>;

async function mount(tag: 'erp-online-booking-list' | 'erp-online-booking-settings'): Promise<Wc> {
  if (tag === 'erp-online-booking-list') await import('./components/erp-online-booking-list/erp-online-booking-list');
  else await import('./components/erp-online-booking-settings/erp-online-booking-settings');
  const el = document.createElement(tag) as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

async function settle(el: Wc): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
}

const submitEvent = (): Event => new Event('submit', { cancelable: true });

const byId = (el: Wc, testid: string): Element | null => el.shadowRoot.querySelector(`[data-testid="${testid}"]`);

/** The banner inside the new-booking form (the `create` panel), or null. */
const inPanel = (el: Wc, testid: string): Element | null =>
  el.shadowRoot.querySelector(`form[slot="create"] [data-testid="${testid}"]`);

/** The banner on the PAGE (outside the panel), or null. */
const onPage = (el: Wc, testid: string): Element | null => {
  const banner = byId(el, testid);
  return banner && !banner.closest('form[slot="create"]') ? banner : null;
};

/** Any error banner inside the panel, whatever its testid. */
const anyInPanel = (el: Wc): Element | null => el.shadowRoot.querySelector('form[slot="create"] .err');

function fillBooking(el: Wc): void {
  el.newCustomer = 'Ana López';
  el.newService = 'Corte';
  el.newDate = '2026-10-01';
  el.newTime = '10:00';
}

async function refusedCreate(el: Wc): Promise<void> {
  fillBooking(el);
  refuse = Object.assign(new Error(REFUSAL), { code: 'hub.elevation.required' });
  await el.createBooking(submitEvent());
  await settle(el);
}

async function refusedRowAction(el: Wc): Promise<void> {
  refuse = Object.assign(new Error(REFUSAL), { code: 'online_booking.not_found' });
  await el.onRowAction({ detail: { actionId: 'confirm', row: BOOKING } });
  await settle(el);
}

describe('pm#513 · bookings: a refused «Add» is shown INSIDE the new-booking panel', () => {
  it('lands in the panel form, with its text, scrolled into view after it painted', async () => {
    const el = await mount('erp-online-booking-list');
    await refusedCreate(el);
    const banner = inPanel(el, 'online-booking-form-error');
    expect(banner, 'on a phone the panel covers the page: the refusal has to travel with the form').not.toBeNull();
    expect(banner?.textContent?.trim()).toBe(REFUSAL);
    expect(revealed, 'and it is scrolled into view').toContain(banner);
    expect(onPage(el, 'online-booking-error'), 'the page banner under the sheet stays empty').toBeNull();
  });

  it('is revealed once: typing in a field afterwards does not scroll the sheet back to it', async () => {
    const el = await mount('erp-online-booking-list');
    await refusedCreate(el);
    revealed = [];
    el.newCustomer = 'Ana María López';
    await settle(el);
    expect(inPanel(el, 'online-booking-form-error'), 'the refusal is still there while the person fixes it').not.toBeNull();
    expect(revealed, 'a re-render must not yank the sheet back to the banner').toEqual([]);
  });

  it('while the new attempt is being saved, the previous refusal is already gone', async () => {
    const el = await mount('erp-online-booking-list');
    await refusedCreate(el);
    refuse = null;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    fillBooking(el);
    const retry = el.createBooking(submitEvent());
    await settle(el);
    expect(inPanel(el, 'online-booking-form-error'), 'the old refusal must not sit next to a save in progress').toBeNull();
    release();
    await retry;
  });
});

describe('pm#513 · bookings: what goes wrong OUTSIDE the save stays on the page (rv-appointments-227)', () => {
  it('a refused row action (no panel open) is shown on the page, not in the panel', async () => {
    const el = await mount('erp-online-booking-list');
    await refusedRowAction(el);
    expect(onPage(el, 'online-booking-error')?.textContent?.trim()).toBe(REFUSAL);
    expect(anyInPanel(el), 'a message inside a closed panel is invisible').toBeNull();
  });

  it('a list that does not load is shown on the page, not in the panel', async () => {
    loadFails = true;
    const el = await mount('erp-online-booking-list');
    if (dataTableShowsLoadError()) {
      // The shell's table paints a failed load itself (pm#533): the reason is on the table, and a
      // page notice as well would say it twice.
      const table = el.shadowRoot.querySelector<HTMLElement & { error?: string }>('ok-data-table[testid="online-booking-table"]');
      expect(table?.error).toBe('list down');
      expect(byId(el, 'online-booking-load-error'), 'said twice').toBeNull();
    } else {
      expect(onPage(el, 'online-booking-load-error')).not.toBeNull();
    }
    expect(anyInPanel(el)).toBeNull();
  });

  it('a new row action clears the refusal of the previous one', async () => {
    const el = await mount('erp-online-booking-list');
    await refusedRowAction(el);
    refuse = null;
    await el.onRowAction({ detail: { actionId: 'confirm', row: BOOKING } });
    await settle(el);
    expect(onPage(el, 'online-booking-error')).toBeNull();
  });

  it('the page refusal of a row action goes away once a later «Add» succeeds (staff#75)', async () => {
    const el = await mount('erp-online-booking-list');
    await refusedRowAction(el);
    refuse = null;
    fillBooking(el);
    await el.createBooking(submitEvent());
    await settle(el);
    expect(onPage(el, 'online-booking-error'), 'a stale refusal must not stay red after a save that worked').toBeNull();
  });

  it('a refused «Add» does not wipe the page and a refused row action does not reach the panel', async () => {
    const el = await mount('erp-online-booking-list');
    await refusedRowAction(el);
    expect(inPanel(el, 'online-booking-form-error')).toBeNull();
    await refusedCreate(el);
    expect(inPanel(el, 'online-booking-form-error')).not.toBeNull();
    expect(onPage(el, 'online-booking-error'), 'the row refusal is still on the page: nothing fixed it').not.toBeNull();
  });

  it('a row action that works does not wipe the refusal of the form the person is still fixing', async () => {
    const el = await mount('erp-online-booking-list');
    await refusedCreate(el);
    refuse = null;
    await el.onRowAction({ detail: { actionId: 'confirm', row: BOOKING } });
    await settle(el);
    expect(inPanel(el, 'online-booking-form-error')?.textContent?.trim(), 'the booking in the panel is still not saved').toBe(REFUSAL);
  });
});

describe('pm#513 · settings: the result of «Save» is brought into view', () => {
  async function refusedSave(el: Wc): Promise<void> {
    refuse = Object.assign(new Error(REFUSAL), { code: 'online_booking.invalid' });
    await el.save(submitEvent());
    await settle(el);
  }

  it('a refused save is shown in the form and scrolled into view after it painted', async () => {
    const el = await mount('erp-online-booking-settings');
    await refusedSave(el);
    const banner = byId(el, 'online-booking-settings-error');
    expect(banner?.textContent?.trim()).toBe(REFUSAL);
    expect(banner?.closest('form'), 'the banner belongs to the settings form').not.toBeNull();
    expect(revealed, 'at 390 px the banner is above the fold: it has to be brought into view').toContain(banner);
  });

  it('is revealed once: editing a field afterwards does not scroll back to it', async () => {
    const el = await mount('erp-online-booking-settings');
    await refusedSave(el);
    revealed = [];
    el.set('page_title', 'Reserva tu cita');
    await settle(el);
    expect(revealed).toEqual([]);
  });

  it('while the new attempt is being saved, the previous refusal is already gone', async () => {
    const el = await mount('erp-online-booking-settings');
    await refusedSave(el);
    refuse = null;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const retry = el.save(submitEvent());
    await settle(el);
    expect(byId(el, 'online-booking-settings-error')).toBeNull();
    release();
    await retry;
  });

  it('a save that works is confirmed in view too', async () => {
    const el = await mount('erp-online-booking-settings');
    await el.save(submitEvent());
    await settle(el);
    const ok = byId(el, 'online-booking-settings-saved');
    expect(ok, 'the confirmation is painted').not.toBeNull();
    expect(revealed, 'and brought into view, or the person cannot tell it was saved').toContain(ok);
    expect(byId(el, 'online-booking-settings-error')).toBeNull();
  });
});
