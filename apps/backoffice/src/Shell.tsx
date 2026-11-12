import { useEffect, useState, type FormEvent } from 'react';
import { api, type Me } from './api';
import { formatOrgNumber, ROLE_LABELS } from './format';
import { AuditPage } from './pages/AuditPage';
import { MenuPage } from './pages/MenuPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlatformPage } from './pages/PlatformPage';
import { RestaurantsPage } from './pages/RestaurantsPage';
import { StaffPage } from './pages/StaffPage';
import { ZReportsPage } from './pages/ZReportsPage';
import { LanguageToggle, useT } from './i18n';
import { useAction } from './useLoad';

const COMPANY_PAGES = {
  restaurants: 'Restaurants & registers',
  menu: 'Menu',
  staff: 'Staff',
  z: 'Z reports',
  audit: 'Change log',
} as const;

type Page = 'overview' | 'platform' | keyof typeof COMPANY_PAGES;

const COMPANY_KEY = 'backoffice.company';

function pageFromHash(): Page {
  const hash = window.location.hash.replace('#/', '');
  return (['overview', 'platform', ...Object.keys(COMPANY_PAGES)] as string[]).includes(hash)
    ? (hash as Page)
    : 'overview';
}

interface Props {
  me: Me;
  onChanged: () => Promise<void>;
  onLogout: () => void;
}

export function Shell({ me, onChanged, onLogout }: Props) {
  const t = useT();
  const [page, setPage] = useState<Page>(pageFromHash);
  const [tenantId, setTenantId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(COMPANY_KEY);
      if (saved && me.companies.some((c) => c.tenantId === saved)) return saved;
    } catch {
      // ignore
    }
    return me.companies[0]?.tenantId ?? null;
  });
  const [addingCompany, setAddingCompany] = useState(false);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function selectCompany(id: string) {
    setTenantId(id);
    try {
      localStorage.setItem(COMPANY_KEY, id);
    } catch {
      // ignore
    }
  }

  const company = me.companies.find((c) => c.tenantId === tenantId) ?? null;
  const go = (p: Page) => {
    window.location.hash = `#/${p}`;
    setPage(p);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <p className="brand">Restaurant POS</p>

        <nav>
          <button className={page === 'overview' ? 'active' : ''} onClick={() => go('overview')}>
            {t('Overview')}
          </button>
        </nav>

        {me.companies.length > 0 && (
          <div className="company-picker">
            <label className="field small">
              {t('Company')}
              <select value={tenantId ?? ''} onChange={(e) => selectCompany(e.target.value)}>
                {me.companies.map((c) => (
                  <option key={c.tenantId} value={c.tenantId}>
                    {c.legalName}
                  </option>
                ))}
              </select>
            </label>
            {company && (
              <p className="muted small">
                {formatOrgNumber(company.orgNumber)} · {t(ROLE_LABELS[company.role])}
              </p>
            )}
          </div>
        )}

        {company && (
          <nav>
            {(Object.keys(COMPANY_PAGES) as (keyof typeof COMPANY_PAGES)[]).map((p) => (
              <button key={p} className={page === p ? 'active' : ''} onClick={() => go(p)}>
                {t(COMPANY_PAGES[p])}
              </button>
            ))}
          </nav>
        )}

        <button className="link small" onClick={() => setAddingCompany(true)}>
          {t('+ Register another company')}
        </button>

        {me.isPlatformAdmin && (
          <nav className="platform-nav">
            <button className={page === 'platform' ? 'active' : ''} onClick={() => go('platform')}>
              {t('Platform')}
            </button>
          </nav>
        )}

        <div className="sidebar-footer">
          <LanguageToggle />
          <p className="small">{me.user.displayName}</p>
          <button className="link small" onClick={onLogout}>
            {t('Log out')}
          </button>
        </div>
      </aside>

      <main className="content">
        {!me.user.emailVerified && me.user.email && <VerifyBanner email={me.user.email} />}
        {page === 'overview' && <OverviewPage />}
        {page === 'platform' && me.isPlatformAdmin && <PlatformPage />}
        {company && page === 'restaurants' && <RestaurantsPage tenantId={company.tenantId} />}
        {company && page === 'menu' && <MenuPage tenantId={company.tenantId} />}
        {company && page === 'staff' && (
          <StaffPage tenantId={company.tenantId} myRole={company.role} myUserId={me.user.userId} />
        )}
        {company && page === 'z' && <ZReportsPage tenantId={company.tenantId} />}
        {company && page === 'audit' && <AuditPage tenantId={company.tenantId} />}
        {!company && page !== 'overview' && page !== 'platform' && (
          <p className="muted">{t('You do not manage any company yet.')}</p>
        )}
      </main>

      {addingCompany && (
        <AddCompanyDialog
          onClose={() => setAddingCompany(false)}
          onAdded={async (id) => {
            setAddingCompany(false);
            await onChanged();
            selectCompany(id);
            go('restaurants');
          }}
        />
      )}
    </div>
  );
}

function AddCompanyDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (tenantId: string) => Promise<void>;
}) {
  const t = useT();
  const [form, setForm] = useState({ legalName: '', orgNumber: '', restaurantName: '' });
  const { busy, error, run } = useAction();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    let id = '';
    if (await run(async () => (id = (await api.addCompany(form)).tenantId))) await onAdded(id);
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('Register company')}>
      <form className="dialog stack" onSubmit={submit}>
        <h2>{t('Register another company')}</h2>
        <p className="muted small">
          {t('A separate organisation number. Waits for approval before the registers can sell.')}
        </p>
        <label className="field">
          {t('Company name')}
          <input required value={form.legalName} onChange={set('legalName')} />
        </label>
        <label className="field">
          {t('Organisation number')}
          <input
            required
            placeholder="556677-8899"
            value={form.orgNumber}
            onChange={set('orgNumber')}
          />
        </label>
        <label className="field">
          {t('First restaurant')}
          <input required value={form.restaurantName} onChange={set('restaurantName')} />
        </label>
        {error && <p className="error">{t(error)}</p>}
        <div className="row-actions">
          <button type="button" className="secondary" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {t('Register')}
          </button>
        </div>
      </form>
    </div>
  );
}

function VerifyBanner({ email }: { email: string }) {
  const t = useT();
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <p className="notice">
      {t('Confirm your email address {email} with the link we sent.', { email })}{' '}
      {sent ? (
        t('New link sent.')
      ) : (
        <button
          className="link"
          disabled={busy}
          onClick={async () => setSent(await run(() => api.resendVerification()))}
        >
          {t('Send again')}
        </button>
      )}
      {error && ` ${t(error)}`}
    </p>
  );
}
