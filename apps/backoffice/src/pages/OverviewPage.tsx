import { useState } from 'react';
import { api } from '../api';
import { formatKr, formatOrgNumber } from '../format';
import { useT } from '../i18n';
import { useLoad } from '../useLoad';

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

/** Sales for one day across every company the user manages, each company kept separate. */
export function OverviewPage() {
  const t = useT();
  const [date, setDate] = useState(today);
  const { data, error } = useLoad(() => api.overview(date), [date]);

  return (
    <section>
      <header className="page-header">
        <h1>{t('Overview')}</h1>
        <input
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value || today())}
        />
      </header>
      {error && <p className="error">{t(error)}</p>}
      {data && data.companies.length === 0 && (
        <p className="muted">
          {t('You do not manage any company. Register one in the menu on the left.')}
        </p>
      )}
      {data && data.companies.length > 0 && (
        <>
          <div className="stat-row">
            <div className="stat">
              <span className="muted small">{t('Net sales, all companies')}</span>
              <strong>{formatKr(data.netOre)}</strong>
            </div>
            <div className="stat">
              <span className="muted small">{t('Companies')}</span>
              <strong>{data.companies.length}</strong>
            </div>
            <div className="stat">
              <span className="muted small">{t('Restaurants')}</span>
              <strong>{data.companies.reduce((n, c) => n + c.restaurants.length, 0)}</strong>
            </div>
          </div>
          {data.companies.map((c) => (
            <div key={c.tenantId} className="card">
              <div className="card-header">
                <div>
                  <h2>{c.legalName}</h2>
                  <p className="muted small">{formatOrgNumber(c.orgNumber)}</p>
                </div>
                <strong className="amount">{formatKr(c.netOre)}</strong>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>{t('Restaurant')}</th>
                    <th className="num">{t('Receipts')}</th>
                    <th className="num">{t('Returns')}</th>
                    <th className="num">{t('Net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.restaurants.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="num">{r.sales}</td>
                      <td className="num">{r.returns}</td>
                      <td className="num">{formatKr(r.netOre)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
