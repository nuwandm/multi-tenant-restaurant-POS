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
import { useAction } from './useLoad';

const COMPANY_PAGES = {
  restaurants: 'Restauranger & kassor',
  menu: 'Meny',
  staff: 'Personal',
  z: 'Z-rapporter',
  audit: 'Ändringslogg',
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
        <p className="brand">Restaurang POS</p>

        <nav>
          <button className={page === 'overview' ? 'active' : ''} onClick={() => go('overview')}>
            Översikt
          </button>
        </nav>

        {me.companies.length > 0 && (
          <div className="company-picker">
            <label className="field small">
              Företag
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
                {formatOrgNumber(company.orgNumber)} · {ROLE_LABELS[company.role]}
              </p>
            )}
          </div>
        )}

        {company && (
          <nav>
            {(Object.keys(COMPANY_PAGES) as (keyof typeof COMPANY_PAGES)[]).map((p) => (
              <button key={p} className={page === p ? 'active' : ''} onClick={() => go(p)}>
                {COMPANY_PAGES[p]}
              </button>
            ))}
          </nav>
        )}

        <button className="link small" onClick={() => setAddingCompany(true)}>
          + Registrera ett till företag
        </button>

        {me.isPlatformAdmin && (
          <nav className="platform-nav">
            <button className={page === 'platform' ? 'active' : ''} onClick={() => go('platform')}>
              Plattform
            </button>
          </nav>
        )}

        <div className="sidebar-footer">
          <p className="small">{me.user.displayName}</p>
          <button className="link small" onClick={onLogout}>
            Logga ut
          </button>
        </div>
      </aside>

      <main className="content">
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
          <p className="muted">Du hanterar inget företag än.</p>
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
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Registrera företag">
      <form className="dialog stack" onSubmit={submit}>
        <h2>Registrera ett till företag</h2>
        <p className="muted small">
          Ett eget organisationsnummer. Väntar på godkännande innan kassorna kan sälja.
        </p>
        <label className="field">
          Företagsnamn
          <input required value={form.legalName} onChange={set('legalName')} />
        </label>
        <label className="field">
          Organisationsnummer
          <input
            required
            placeholder="556677-8899"
            value={form.orgNumber}
            onChange={set('orgNumber')}
          />
        </label>
        <label className="field">
          Första restaurangen
          <input required value={form.restaurantName} onChange={set('restaurantName')} />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Avbryt
          </button>
          <button className="primary" disabled={busy}>
            Registrera
          </button>
        </div>
      </form>
    </div>
  );
}
