import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
// Catálogo i18n del módulo (ADR-0055): esbuild inlinea estos JSON en el `dist` del WC. Los textos
// internos se resuelven con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
}

interface Settings {
  is_enabled: number;
  page_title: string;
  welcome_message: string;
  primary_color: string;
  logo_url: string;
  require_phone: number;
  require_email: number;
  allow_staff_selection: number;
  allow_notes: number;
  min_advance_hours: number;
  max_advance_days: number;
  slot_duration_minutes: number;
  buffer_minutes: number;
  confirmation_message: string;
  cancellation_policy: string;
}

const DEFAULTS: Settings = {
  is_enabled: 0,
  page_title: 'Book an Appointment',
  welcome_message: '',
  primary_color: '#6366f1',
  logo_url: '',
  require_phone: 1,
  require_email: 1,
  allow_staff_selection: 1,
  allow_notes: 1,
  min_advance_hours: 2,
  max_advance_days: 30,
  slot_duration_minutes: 30,
  buffer_minutes: 0,
  confirmation_message: '',
  cancellation_policy: '',
};

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpOnlineBookingSettings extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ink, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(14rem,1fr)); gap:.75rem; margin-bottom:1rem; }
    .field { display:flex; flex-direction:column; gap:.25rem; }
    label { font-size:.85rem; color: var(--muted,#6b6557); }
    .row { display:flex; align-items:center; gap:.5rem; }
    .err { color:#d9480f; font-weight:600; }
    .ok { color:#2b8a3e; font-weight:600; }
    .actions { display:flex; gap:.5rem; margin-top:.5rem; }
  `;

  @state() s: Settings = { ...DEFAULTS };

  @state() loading = true;

  @state() saving = false;

  @state() error = '';

  @state() saved = false;

  private readonly onLocaleChange = (): void => this.requestUpdate();

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    await this.refresh();
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    super.disconnectedCallback();
  }

  private async refresh() {
    this.loading = true;
    this.error = '';
    try {
      const rows = await erplora().query<Settings[]>('online_booking.settings.get');
      const row = Array.isArray(rows) ? rows[0] : (rows as unknown as Settings | undefined);
      this.s = row ? { ...DEFAULTS, ...row } : { ...DEFAULTS };
    } catch (e) {
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errorLoadSettings');
    } finally {
      this.loading = false;
    }
  }

  private set<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.s = { ...this.s, [key]: value };
    this.saved = false;
  }

  private async save(ev: Event) {
    ev.preventDefault();
    this.saving = true;
    this.error = '';
    this.saved = false;
    try {
      await erplora().command('online_booking.settings.upsert', {
        is_enabled: !!this.s.is_enabled,
        page_title: this.s.page_title,
        welcome_message: this.s.welcome_message,
        primary_color: this.s.primary_color,
        logo_url: this.s.logo_url,
        require_phone: !!this.s.require_phone,
        require_email: !!this.s.require_email,
        allow_staff_selection: !!this.s.allow_staff_selection,
        allow_notes: !!this.s.allow_notes,
        min_advance_hours: Number(this.s.min_advance_hours) || 0,
        max_advance_days: Number(this.s.max_advance_days) || 1,
        slot_duration_minutes: Number(this.s.slot_duration_minutes) || 30,
        buffer_minutes: Number(this.s.buffer_minutes) || 0,
        confirmation_message: this.s.confirmation_message,
        cancellation_policy: this.s.cancellation_policy,
      });
      this.saved = true;
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errorSave');
    } finally {
      this.saving = false;
    }
  }

  render() {
    const t = (k: string) => erplora().t(CATALOG, k);
    return html`<form @submit=${(e) => this.save(e)}>
        <header>
          <h2>${t('ui.settingsTitle')}</h2>
        </header>
        ${this.error ? html`<p class="err">${this.error}</p>` : nothing}
        ${this.saved ? html`<p class="ok">${t('ui.settingsSaved')}</p>` : nothing}
        <div class="row" style="margin-bottom:1rem">
          <ion-toggle ?checked=${!!this.s.is_enabled} @ionChange=${(e: any) => this.set('is_enabled', e.target.checked ? 1 : 0)}></ion-toggle>
          <label>${t('ui.labelPublicEnabled')}</label>
        </div>
        <div class="grid">
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelPageTitle')} .value=${this.s.page_title} @ionInput=${(e: any) => this.set('page_title', e.target.value)}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelPrimaryColor')} .value=${this.s.primary_color} @ionInput=${(e: any) => this.set('primary_color', e.target.value)}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelLogoUrl')} .value=${this.s.logo_url} @ionInput=${(e: any) => this.set('logo_url', e.target.value)}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelMinAdvanceHours')} type="number" min="0" max="168" .value=${String(this.s.min_advance_hours)} @ionInput=${(e: any) => this.set('min_advance_hours', Number(e.target.value))}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelMaxAdvanceDays')} type="number" min="1" max="365" .value=${String(this.s.max_advance_days)} @ionInput=${(e: any) => this.set('max_advance_days', Number(e.target.value))}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelSlotDuration')} type="number" min="5" max="480" .value=${String(this.s.slot_duration_minutes)} @ionInput=${(e: any) => this.set('slot_duration_minutes', Number(e.target.value))}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelBuffer')} type="number" min="0" max="120" .value=${String(this.s.buffer_minutes)} @ionInput=${(e: any) => this.set('buffer_minutes', Number(e.target.value))}></ion-input>
          </div>
        </div>
        <div class="grid">
          <div class="row">
            <ion-toggle ?checked=${!!this.s.require_phone} @ionChange=${(e: any) => this.set('require_phone', e.target.checked ? 1 : 0)}></ion-toggle>
            <label>${t('ui.labelRequirePhone')}</label>
          </div>
          <div class="row">
            <ion-toggle ?checked=${!!this.s.require_email} @ionChange=${(e: any) => this.set('require_email', e.target.checked ? 1 : 0)}></ion-toggle>
            <label>${t('ui.labelRequireEmail')}</label>
          </div>
          <div class="row">
            <ion-toggle ?checked=${!!this.s.allow_staff_selection} @ionChange=${(e: any) => this.set('allow_staff_selection', e.target.checked ? 1 : 0)}></ion-toggle>
            <label>${t('ui.labelAllowStaffSelection')}</label>
          </div>
          <div class="row">
            <ion-toggle ?checked=${!!this.s.allow_notes} @ionChange=${(e: any) => this.set('allow_notes', e.target.checked ? 1 : 0)}></ion-toggle>
            <label>${t('ui.labelAllowNotes')}</label>
          </div>
        </div>
        <div class="field">
          <ion-textarea fill="outline" label-placement="floating" label=${t('ui.labelWelcomeMessage')} .value=${this.s.welcome_message} @ionInput=${(e: any) => this.set('welcome_message', e.target.value)}></ion-textarea>
        </div>
        <div class="field">
          <ion-textarea fill="outline" label-placement="floating" label=${t('ui.labelConfirmationMessage')} .value=${this.s.confirmation_message} @ionInput=${(e: any) => this.set('confirmation_message', e.target.value)}></ion-textarea>
        </div>
        <div class="field">
          <ion-textarea fill="outline" label-placement="floating" label=${t('ui.labelCancellationPolicy')} .value=${this.s.cancellation_policy} @ionInput=${(e: any) => this.set('cancellation_policy', e.target.value)}></ion-textarea>
        </div>
        <div class="actions">
          <ion-button type="submit" ?disabled=${this.saving || this.loading}>${this.saving ? t('ui.buttonSaving') : t('ui.buttonSave')}</ion-button>
        </div>
      </form>`;
  }
}

define('erp-online-booking-settings', ErpOnlineBookingSettings);
