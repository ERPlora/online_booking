import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';
import { createListController, dataTableShowsLoadError } from '@erplora/module-sdk';
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
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    /* La vista llena el alto: el data-table ocupa todo (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
    /* Formulario del panel de alta (drawer estrecho) → una columna, no en fila. */
    .form { display:flex; flex-direction:column; gap:.7rem; }
    .form ion-button { align-self:flex-end; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() saving = false;

  /** Refusal of the new-booking save: painted INSIDE the `create` panel form (pm#513). */
  @state() formError = '';

  /** Refusal of a row action: stays on the page, where the action was triggered. */
  @state() pageError = '';

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
            // Una suscripción por evento, con su literal EN la llamada (ADR-0127: el extractor
      // de contratos no sigue arrays; el nombre vive donde se usa).
      const offs = [
        erplora().on('online_booking.booking.created', () => this.ctrl.load()),
        erplora().on('online_booking.booking.confirmed', () => this.ctrl.load()),
        erplora().on('online_booking.booking.cancelled', () => this.ctrl.load()),
        erplora().on('online_booking.booking.completed', () => this.ctrl.load()),
        erplora().on('online_booking.booking.no_show', () => this.ctrl.load()),
        erplora().on('online_booking.booking.deleted', () => this.ctrl.load()),
      ];
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

  // Referencia al ok-data-table para abrir/cerrar su panel lateral (el «+» de su barra).
  private dataTable(): { open(p?: 'filters' | 'create'): void; close(): void } | null {
    return this.renderRoot.querySelector('ok-data-table') as
      | { open(p?: 'filters' | 'create'): void; close(): void }
      | null;
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
      this.pageError = ''; // a save that worked does not leave an older row refusal in red (staff#75)
      this.dataTable()?.close(); // el panel del «+» taparía la tabla y la reserva recién creada
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
    this.pageError = '';
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
      this.pageError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errorUpdate');
    }
  }

  // Under 834 px the `create` panel is a full-screen sheet: the refusal is painted inside it and
  // scrolled into view once, when it appears — not on every re-render while the person fixes a field.
  updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('formError') && this.formError) {
      this.renderRoot.querySelector('[data-testid="online-booking-form-error"]')?.scrollIntoView?.({ block: 'center' });
    }
  }

  // The view title is painted by the shell topbar: repeating it here duplicated it on screen.
  render() {
    const t = (k: string) => erplora().t(CATALOG, k);
    return html`<div class="page">
        ${this.pageError ? html`<p class="err" data-testid="online-booking-error">${this.pageError}</p>` : nothing}
        ${this.ctrl?.error && !dataTableShowsLoadError() ? html`<p class="err" data-testid="online-booking-load-error">${this.ctrl.error}</p>` : nothing}
        <ok-data-table testid="online-booking-table" .error=${this.ctrl?.error ?? ''} @retry=${() => this.ctrl?.load()} .serverSide=${true} .fill=${true} .addable=${true} .views=${true} .cardTitle=${(row: Record<string, unknown>) => String(row.booking_reference ?? row.customer_name ?? '—')} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'asc'} .searchable=${true} .actions=${this.actions} .searchPlaceholder=${t('ui.searchPlaceholder')} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.empty')} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @pageSizeChange=${(e: CustomEvent<number>) => this.ctrl.setPageSize(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}>
          <!-- New booking: projected ALWAYS (even with the panel closed); if it were painted only
               when opened, the «+» would unfold an empty panel on the first click. -->
          <form slot="create" class="form" @submit=${(e: Event) => this.createBooking(e)}>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colCustomer')} .value=${this.newCustomer} @ionInput=${(e: any) => (this.newCustomer = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colService')} .value=${this.newService} @ionInput=${(e: any) => (this.newService = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.placeholderStaff')} .value=${this.newStaff} @ionInput=${(e: any) => (this.newStaff = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colDate')} type="date" .value=${this.newDate} @ionInput=${(e: any) => (this.newDate = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colTime')} type="time" .value=${this.newTime} @ionInput=${(e: any) => (this.newTime = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.placeholderDuration')} type="number" min="5" step="5" .value=${this.newDuration} @ionInput=${(e: any) => (this.newDuration = e.target.value)}></ion-input>
            ${this.formError ? html`<p class="err" data-testid="online-booking-form-error">${this.formError}</p>` : nothing}
            <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCustomer || !this.newService || !this.newDate || !this.newTime}>${this.saving ? t('ui.buttonSaving') : t('ui.buttonAdd')}</ion-button>
          </form>
        </ok-data-table>
      </div>`;
  }
}

define('erp-online-booking-list', ErpOnlineBookingList);
