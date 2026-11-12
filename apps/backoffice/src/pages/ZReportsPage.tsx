import { api } from '../api';
import { formatDateTime, formatKr } from '../format';
import { useT } from '../i18n';
import { useLoad } from '../useLoad';

export function ZReportsPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { data, error } = useLoad(() => api.zReports(tenantId), [tenantId]);
  return (
    <section>
      <header className="page-header">
        <h1>{t('Z reports')}</h1>
      </header>
      {error && <p className="error">{t(error)}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>{t('Restaurant')}</th>
              <th>{t('Register name')}</th>
              <th className="num">{t('Z no.')}</th>
              <th>Period</th>
              <th className="num">{t('Receipts')}</th>
              <th className="num">{t('Sales')}</th>
              <th className="num">{t('Returns')}</th>
              <th className="num">{t('Net')}</th>
              <th className="num">Grand total</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((z) => (
              <tr key={z.id}>
                <td>{z.restaurant}</td>
                <td>{z.register}</td>
                <td className="num">{z.zNumber}</td>
                <td className="small">
                  {formatDateTime(z.periodFrom)} – {formatDateTime(z.periodTo)}
                </td>
                <td className="num">{z.saleCount}</td>
                <td className="num">{formatKr(z.salesTotalOre)}</td>
                <td className="num">{formatKr(z.returnsTotalOre)}</td>
                <td className="num">
                  <strong>{formatKr(z.netTotalOre)}</strong>
                </td>
                <td className="num">{formatKr(z.grandTotalOre)}</td>
              </tr>
            ))}
            {data?.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  {t('No Z reports yet. They are taken at the till when the day is closed.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
