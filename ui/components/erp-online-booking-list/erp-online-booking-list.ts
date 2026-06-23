import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';
// Catálogo i18n del módulo (ADR-0055): esbuild inlinea estos JSON en el `dist` del WC. Los textos
// internos se resuelven con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
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

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: 'ui.statusPending',
    confirmed: 'ui.statusConfirmed',
    cancelled: 'ui.statusCancelled',
    completed: 'ui.statusCompleted',
    no_show: 'ui.statusNoShow',
  };
  const key = map[status];
  return key ? erplora().t(CATALOG, key) : status;
}

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
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1.25rem; }
    .form ion-input, .form ion-select { flex:1 1 11rem; min-width:9rem; }
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

  // i18n del módulo (ADR-0055): se reconstruye al cambiar de idioma porque es un getter.
  private get columns(): DataTableColumn[] {
    const t = (k: string) => erplora().t(CATALOG, k);
    return [
      { key: 'booking_reference', header: t('ui.colRef'), sortable: true, filterable: true, filterType: 'text' },
      { key: 'customer_name', header: t('ui.colCustomer'), sortable: true, filterable: true, filterType: 'text' },
      { key: 'service_name', header: t('ui.colService'), sortable: true, filterable: true, filterType: 'text' },
      { key: 'staff_name', header: t('ui.colStaff'), sortable: true, filterable: true, filterType: 'text' },
      { key: 'booking_date', header: t('ui.colDate'), sortable: true, filterable: true, filterType: 'daterange' },
      {
        key: 'booking_time',
        header: t('ui.colTime'),
        sortable: true,
        filterable: true,
        filterType: 'text',
        format: (r) => String(r.booking_time ?? '').slice(0, 5),
      },
      {
        key: 'status',
        header: t('ui.colStatus'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: [
          { value: 'pending', label: t('ui.statusPending') },
          { value: 'confirmed', label: t('ui.statusConfirmed') },
          { value: 'completed', label: t('ui.statusCompleted') },
          { value: 'cancelled', label: t('ui.statusCancelled') },
          { value: 'no_show', label: t('ui.statusNoShow') },
        ],
        format: (r) => statusLabel(r.status as string),
      },
    ];
  }

  private get actions() {
    const t = (k: string) => erplora().t(CATALOG, k);
    return [
      { id: 'confirm', label: t('ui.actionConfirm'), icon: 'checkmark-outline', color: 'success' },
      { id: 'complete', label: t('ui.actionComplete'), icon: 'checkmark-done-outline', color: 'primary' },
      { id: 'no_show', label: t('ui.actionNoShow'), icon: 'close-circle-outline', color: 'medium' },
      { id: 'cancel', label: t('ui.actionCancel'), icon: 'ban-outline', color: 'warning' },
      { id: 'delete', label: t('ui.actionDelete'), icon: 'trash-outline', color: 'danger' },
    ];
  }

  private readonly onLocaleChange = (): void => this.requestUpdate();

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
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
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
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
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errorCreate');
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
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errorUpdate');
    }
  }

  render() {
    const t = (k: string) => erplora().t(CATALOG, k);
    return html`<div>
        <header>
          <h2>${t('ui.title')}</h2>
        </header>
        <form class="form" @submit=${(e) => this.createBooking(e)}>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colCustomer')} .value=${this.newCustomer} @ionInput=${(e: any) => (this.newCustomer = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colService')} .value=${this.newService} @ionInput=${(e: any) => (this.newService = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.placeholderStaff')} .value=${this.newStaff} @ionInput=${(e: any) => (this.newStaff = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colDate')} type="date" .value=${this.newDate} @ionInput=${(e: any) => (this.newDate = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colTime')} type="time" .value=${this.newTime} @ionInput=${(e: any) => (this.newTime = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.placeholderDuration')} type="number" min="5" step="5" .value=${this.newDuration} @ionInput=${(e: any) => (this.newDuration = e.target.value)}></ion-input>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCustomer || !this.newService || !this.newDate || !this.newTime}>${this.saving ? t('ui.buttonSaving') : t('ui.buttonAdd')}</ion-button>
        </form>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .actions=${this.actions} .searchPlaceholder=${t('ui.searchPlaceholder')} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.empty')} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-online-booking-list', ErpOnlineBookingList);
