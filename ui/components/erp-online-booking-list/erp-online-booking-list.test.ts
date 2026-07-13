// Contrato de la BARRA de la lista de reservas online.
//
// El alta de una reserva online vive DENTRO de `ok-data-table`, detrás del «+» de su barra (panel
// `slot="create"`), igual que /employees del core y que el CRUD de productos de `inventory`. Fuera
// de la tabla no queda ningún control de alta suelto, y el título lo pinta el topbar del shell.
//
// Los filtros van dentro de la tabla (embudo) y el estado —dominio cerrado de la migración
// (pending|confirmed|cancelled|completed|no_show)— se filtra con un `select`. El servidor lo
// soporta: `online_booking.bookings.list` declara `filters.status = { op: eq }` en su bloque
// `list` del module.json.
import { beforeEach, describe, expect, it } from 'vitest';

const comandos: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  comandos.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async () => ({
      rows: [
        {
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
        },
      ],
      total: 1,
    }),
    command: async (name: string, payload: Record<string, unknown>) => {
      comandos.push({ name, payload });
      return {};
    },
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

async function montar() {
  await import('./erp-online-booking-list');
  const el = document.createElement('erp-online-booking-list');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

type Tabla = HTMLElement & { addable: boolean; fill: boolean; panel: string; open: (p?: 'filters' | 'create') => void };
const tabla = (el: HTMLElement & { shadowRoot: ShadowRoot }) => el.shadowRoot.querySelector('ok-data-table') as Tabla | null;

describe('el alta vive DENTRO de la tabla (paridad con /employees e inventory)', () => {
  it('la tabla declara `addable` → pinta el «+» en su barra', async () => {
    const el = await montar();
    expect(tabla(el)?.addable, 'sin `addable` no hay «+» en la barra de la tabla').toBe(true);
  });

  it('la tabla llena el alto de la vista (`fill`)', async () => {
    const el = await montar();
    expect(tabla(el)?.fill, 'sin `fill` la tabla no ocupa el alto: sin scroll interno ni pie fijo').toBe(true);
  });

  it('el formulario de alta se proyecta en el panel `create` de la tabla', async () => {
    const el = await montar();
    const form = el.shadowRoot.querySelector('form[slot="create"]');
    expect(form, 'el formulario de alta no está en el slot `create`').toBeTruthy();
    expect(form?.closest('ok-data-table'), 'el formulario de alta cuelga fuera de la tabla').toBeTruthy();
  });

  it('no queda NINGÚN control de alta suelto fuera de la tabla', async () => {
    const el = await montar();
    const sueltos = [...el.shadowRoot.querySelectorAll('form, ion-input, ion-select, ion-button')].filter(
      (n) => !n.closest('ok-data-table'),
    );
    expect(sueltos.map((n) => n.tagName.toLowerCase()), 'hay controles de alta fuera de la tabla').toEqual([]);
  });

  it('la vista no pinta su propio título (lo pone el topbar del shell)', async () => {
    const el = await montar();
    expect(el.shadowRoot.querySelector('h2'), 'el título duplicado: ya lo pinta el topbar').toBeNull();
  });
});

describe('los filtros van en la tabla, y el estado (dominio cerrado) es un `select`', () => {
  it('el estado se filtra con un select con los 5 estados de la migración', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; filterType?: string; options?: { value: string }[] }[] }).columns;
    const estado = cols.find((c) => c.key === 'status');
    expect(estado?.filterType, 'el estado se filtra tecleando texto libre').toBe('select');
    expect(estado?.options?.map((o) => o.value)).toEqual(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']);
  });
});

describe('el alta sigue funcionando desde el panel', () => {
  it('crear una reserva online manda online_booking.bookings.create y CIERRA el panel', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    const wc = el as unknown as {
      newCustomer: string;
      newService: string;
      newStaff: string;
      newDate: string;
      newTime: string;
      newDuration: string;
      createBooking: (ev: Event) => Promise<void>;
    };
    wc.newCustomer = 'Ana';
    wc.newService = 'Corte';
    wc.newStaff = 'Eva';
    wc.newDate = '2026-07-13';
    wc.newTime = '10:00';
    wc.newDuration = '45';
    await wc.createBooking(new Event('submit'));

    const alta = comandos.find((c) => c.name === 'online_booking.bookings.create');
    expect(alta, 'no se mandó el alta de la reserva online').toBeTruthy();
    expect(alta!.payload.customer_name).toBe('Ana');
    expect(alta!.payload.booking_time).toBe('10:00:00');
    expect(alta!.payload.duration_minutes).toBe(45);
    expect(tabla(el)?.panel, 'el panel de alta se queda abierto tras crear').toBe('none');
  });
});
