import { useState } from 'react';
import { api, type CompanyStatus } from '../api';
import { formatDateTime, formatKr, formatOrgNumber, STATUS_LABELS } from '../format';
import { useAction, useLoad } from '../useLoad';

const FILTERS: (CompanyStatus | 'all')[] = ['pending', 'active', 'suspended', 'all'];

/** Platform console: every company's status and usage. No receipts, menus or staff details. */
export function PlatformPage() {
  const { data, error, reload } = useLoad(() => api.platformCompanies(), []);
  const action = useAction();
  const [filter, setFilter] = useState<CompanyStatus | 'all'>('all');

  const companies = data?.filter((c) => filter === 'all' || c.status === filter) ?? [];
  const count = (s: CompanyStatus) => data?.filter((c) => c.status === s).length ?? 0;

  async function change(tenantId: string, act: 'approve' | 'suspend' | 'reactivate', name: string) {
    if (act === 'suspend' && !window.confirm(`Stäng av ${name}? Kassorna slutar sälja direkt.`))
      return;
    if (await action.run(() => api.setCompanyStatus(tenantId, act))) reload();
  }

  return (
    <section>
      <header className="page-header">
        <h1>Plattform</h1>
      </header>
      <div className="stat-row">
        <div className="stat">
          <span className="muted small">Väntar på godkännande</span>
          <strong>{count('pending')}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Aktiva företag</span>
          <strong>{count('active')}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Försäljning 30 dagar</span>
          <strong>{formatKr(data?.reduce((s, c) => s + c.sales30dOre, 0) ?? 0)}</strong>
        </div>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Alla' : STATUS_LABELS[f]} {f !== 'all' && `(${count(f)})`}
          </button>
        ))}
      </div>

      {(error || action.error) && <p className="error">{error ?? action.error}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Företag</th>
              <th>Ägare</th>
              <th>Status</th>
              <th className="num">Restauranger</th>
              <th className="num">Kassor</th>
              <th className="num">Personal</th>
              <th>Senaste försäljning</th>
              <th className="num">30 dagar</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.tenantId}>
                <td>
                  <strong>{c.legalName}</strong>
                  <div className="muted small">
                    {formatOrgNumber(c.orgNumber)} · reg. {formatDateTime(c.createdAt)}
                  </div>
                </td>
                <td>
                  {c.owner?.name}
                  <div className="muted small">{c.owner?.email}</div>
                </td>
                <td>
                  <span className={`badge badge-${c.status}`}>{STATUS_LABELS[c.status]}</span>
                </td>
                <td className="num">{c.restaurants}</td>
                <td className="num">
                  {c.activeRegisters}/{c.registers}
                </td>
                <td className="num">{c.staff}</td>
                <td>
                  {c.lastSaleAt ? formatDateTime(c.lastSaleAt) : <span className="muted">–</span>}
                </td>
                <td className="num">{formatKr(c.sales30dOre)}</td>
                <td className="actions">
                  {c.status === 'pending' && (
                    <button
                      className="primary small"
                      disabled={action.busy}
                      onClick={() => change(c.tenantId, 'approve', c.legalName)}
                    >
                      Godkänn
                    </button>
                  )}
                  {c.status === 'active' && (
                    <button
                      className="secondary small"
                      disabled={action.busy}
                      onClick={() => change(c.tenantId, 'suspend', c.legalName)}
                    >
                      Stäng av
                    </button>
                  )}
                  {c.status === 'suspended' && (
                    <button
                      className="secondary small"
                      disabled={action.busy}
                      onClick={() => change(c.tenantId, 'reactivate', c.legalName)}
                    >
                      Återaktivera
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {companies.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  Inga företag här.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
