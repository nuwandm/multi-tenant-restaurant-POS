import { useState } from 'react';
import { api, type CompanyStatus } from '../api';
import { formatDateTime, formatKr, formatOrgNumber, STATUS_LABELS } from '../format';
import { useT } from '../i18n';
import { useAction, useLoad } from '../useLoad';

const FILTERS: (CompanyStatus | 'all')[] = ['pending', 'active', 'suspended', 'all'];

/** Platform console: every company's status and usage. No receipts, menus or staff details. */
export function PlatformPage() {
  const t = useT();
  const { data, error, reload } = useLoad(() => api.platformCompanies(), []);
  const action = useAction();
  const [filter, setFilter] = useState<CompanyStatus | 'all'>('all');

  const companies = data?.filter((c) => filter === 'all' || c.status === filter) ?? [];
  const count = (s: CompanyStatus) => data?.filter((c) => c.status === s).length ?? 0;

  async function change(tenantId: string, act: 'approve' | 'suspend' | 'reactivate', name: string) {
    if (
      act === 'suspend' &&
      !window.confirm(t('Suspend {name}? Its registers stop selling at once.', { name }))
    )
      return;
    if (await action.run(() => api.setCompanyStatus(tenantId, act))) reload();
  }

  return (
    <section>
      <header className="page-header">
        <h1>{t('Platform')}</h1>
      </header>
      <div className="stat-row">
        <div className="stat">
          <span className="muted small">{t('Waiting for approval')}</span>
          <strong>{count('pending')}</strong>
        </div>
        <div className="stat">
          <span className="muted small">{t('Active companies')}</span>
          <strong>{count('active')}</strong>
        </div>
        <div className="stat">
          <span className="muted small">{t('Sales, 30 days')}</span>
          <strong>{formatKr(data?.reduce((s, c) => s + c.sales30dOre, 0) ?? 0)}</strong>
        </div>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? t('All') : t(STATUS_LABELS[f])} {f !== 'all' && `(${count(f)})`}
          </button>
        ))}
      </div>

      {(error || action.error) && <p className="error">{t((error ?? action.error)!)}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>{t('Company')}</th>
              <th>{t('Owner')}</th>
              <th>{t('Status')}</th>
              <th className="num">{t('Restaurants')}</th>
              <th className="num">{t('Registers')}</th>
              <th className="num">{t('Devices')}</th>
              <th className="num">{t('Staff')}</th>
              <th>{t('Last sale')}</th>
              <th className="num">{t('30 days')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.tenantId}>
                <td>
                  <strong>{c.legalName}</strong>
                  <div className="muted small">
                    {formatOrgNumber(c.orgNumber)} ·{' '}
                    {t('signed up {date}', { date: formatDateTime(c.createdAt) })}
                  </div>
                </td>
                <td>
                  {c.owner?.name}
                  <div className="muted small">
                    {c.owner?.email}{' '}
                    {c.owner && !c.owner.emailVerified && (
                      <span className="badge badge-pending">{t('Not confirmed')}</span>
                    )}
                  </div>
                </td>
                <td>
                  <span className={`badge badge-${c.status}`}>{t(STATUS_LABELS[c.status])}</span>
                </td>
                <td className="num">{c.restaurants}</td>
                <td className="num">
                  {c.activeRegisters}/{c.registers}
                </td>
                <td className="num">{c.devices}</td>
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
                      {t('Approve')}
                    </button>
                  )}
                  {c.status === 'active' && (
                    <button
                      className="secondary small"
                      disabled={action.busy}
                      onClick={() => change(c.tenantId, 'suspend', c.legalName)}
                    >
                      {t('Suspend')}
                    </button>
                  )}
                  {c.status === 'suspended' && (
                    <button
                      className="secondary small"
                      disabled={action.busy}
                      onClick={() => change(c.tenantId, 'reactivate', c.legalName)}
                    >
                      {t('Reactivate')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {companies.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  {t('No companies here.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
