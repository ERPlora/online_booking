import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
}

interface Booking {
  id: string;
  booking_reference: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  service_name: string;
  staff_name: string;
  booking_date: string;
  booking_time: string;
  duration_minutes: number;
  status: string;
  booking_type: string;
  notes: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  completed: 'Completada',
  no_show: 'No-show',
};

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpOnlineBookingList extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ink, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .form { display:flex; gap:.5rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1rem; }
    .form ion-input, .form ion-select { --background:var(--surface-2,#f7f4ec); border:1px solid var(--line,#e7e2d6); border-radius:8px; min-width:8rem; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() saving = false;

  @state() formError = '';

  @state() tick = 0;

  @state() newCustomer = '';

  @state() newService = '';

  @state() newDate = '';

  @state() newTime = '';

  @state() newStaff = '';

  @state() newDuration = '30';

  private ctrl!: ListController<Booking>;

  private unsub?: () => void;

  private columns: DataTableColumn[] = [
    { key: 'booking_reference', header: 'Ref', sortable: true, filterable: true, filterType: 'text' },
    { key: 'customer_name', header: 'Cliente', sortable: true, filterable: true, filterType: 'text' },
    { key: 'service_name', header: 'Servicio', sortable: true, filterable: true, filterType: 'text' },
    { key: 'staff_name', header: 'Personal', sortable: true, filterable: true, filterType: 'text' },
    { key: 'booking_date', header: 'Fecha', sortable: true, filterable: true, filterType: 'daterange' },
    {
      key: 'booking_time',
      header: 'Hora',
      sortable: true,
      filterable: true,
      filterType: 'text',
      format: (r) => String(r.booking_time ?? '').slice(0, 5),
    },
    {
      key: 'status',
      header: 'Estado',
      sortable: true,
      filterable: true,
      filterType: 'select',
      options: [
        { value: 'pending', label: 'Pendiente' },
        { value: 'confirmed', label: 'Confirmada' },
        { value: 'completed', label: 'Completada' },
        { value: 'cancelled', label: 'Cancelada' },
        { value: 'no_show', label: 'No-show' },
      ],
      format: (r) => STATUS_LABELS[r.status as string] ?? (r.status as string),
    },
  ];

  private actions = [
    { id: 'confirm', label: 'Confirmar', icon: 'checkmark-outline', color: 'success' },
    { id: 'complete', label: 'Completar', icon: 'checkmark-done-outline', color: 'primary' },
    { id: 'no_show', label: 'No-show', icon: 'close-circle-outline', color: 'medium' },
    { id: 'cancel', label: 'Cancelar', icon: 'ban-outline', color: 'warning' },
    { id: 'delete', label: 'Borrar', icon: 'trash-outline', color: 'danger' },
  ];

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    this.ctrl = createListController<Booking>(erplora(), 'online_booking.bookings.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'id',
      dir: 'asc',
    });
    await this.ctrl.load();
    try {
      const offs = [
        'online_booking.booking.created',
        'online_booking.booking.confirmed',
        'online_booking.booking.cancelled',
        'online_booking.booking.completed',
        'online_booking.booking.no_show',
        'online_booking.booking.deleted',
      ].map((ev) => erplora().on(ev, () => this.ctrl.load()));
      this.unsub = () => offs.forEach((off) => off());
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsub?.();
  }

  private async createBooking(ev: Event) {
    ev.preventDefault();
    if (!this.newCustomer.trim() || !this.newService.trim() || !this.newDate || !this.newTime) return;
    this.saving = true;
    this.formError = '';
    try {
      await erplora().command('online_booking.bookings.create', {
        customer_name: this.newCustomer.trim(),
        service_name: this.newService.trim(),
        staff_name: this.newStaff.trim(),
        booking_date: this.newDate,
        booking_time: this.newTime.length === 5 ? `${this.newTime}:00` : this.newTime,
        duration_minutes: Number(this.newDuration) || 30,
        booking_type: 'appointment',
        notes: '',
      });
      this.newCustomer = '';
      this.newService = '';
      this.newDate = '';
      this.newTime = '';
      this.newStaff = '';
      this.newDuration = '30';
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : 'No se pudo crear la reserva';
    } finally {
      this.saving = false;
    }
  }

  private async onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    const booking_id = String(row.id);
    this.formError = '';
    try {
      if (actionId === 'confirm') {
        await erplora().command('online_booking.bookings.confirm', { booking_id });
      } else if (actionId === 'complete') {
        await erplora().command('online_booking.bookings.complete', { booking_id });
      } else if (actionId === 'no_show') {
        await erplora().command('online_booking.bookings.no_show', { booking_id });
      } else if (actionId === 'cancel') {
        await erplora().command('online_booking.bookings.cancel', { booking_id, reason: '' });
      } else if (actionId === 'delete') {
        await erplora().command('online_booking.bookings.delete', { booking_id });
      }
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : 'No se pudo actualizar la reserva';
    }
  }

  render() {
    return html`<div>
        <header>
          <h2>Reservas online</h2>
        </header>
        <form class="form" @submit=${(e) => this.createBooking(e)}>
          <ion-input placeholder="Cliente" .value=${this.newCustomer} @ionInput=${(e: any) => (this.newCustomer = e.target.value)}></ion-input>
          <ion-input placeholder="Servicio" .value=${this.newService} @ionInput=${(e: any) => (this.newService = e.target.value)}></ion-input>
          <ion-input placeholder="Personal (opcional)" .value=${this.newStaff} @ionInput=${(e: any) => (this.newStaff = e.target.value)}></ion-input>
          <ion-input type="date" .value=${this.newDate} @ionInput=${(e: any) => (this.newDate = e.target.value)}></ion-input>
          <ion-input type="time" .value=${this.newTime} @ionInput=${(e: any) => (this.newTime = e.target.value)}></ion-input>
          <ion-input type="number" min="5" step="5" placeholder="Min." .value=${this.newDuration} @ionInput=${(e: any) => (this.newDuration = e.target.value)}></ion-input>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCustomer || !this.newService || !this.newDate || !this.newTime}>${this.saving ? 'Guardando…' : 'Añadir'}</ion-button>
        </form>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .actions=${this.actions} .searchPlaceholder=${"Buscar ref, cliente, servicio…"} .emptyMessage=${this.ctrl?.loading ? 'Cargando…' : 'Sin reservas.'} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-online-booking-list', ErpOnlineBookingList);
