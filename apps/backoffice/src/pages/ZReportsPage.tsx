import { api } from '../api';
import { formatDateTime, formatKr } from '../format';
import { useLoad } from '../useLoad';

export function ZReportsPage({ tenantId }: { tenantId: string }) {
  const { data, error } = useLoad(() => api.zReports(tenantId), [tenantId]);
  return (
    <section>
      <header className="page-header">
        <h1>Z-rapporter</h1>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Restaurang</th>
              <th>Kassa</th>
              <th className="num">Z nr</th>
              <th>Period</th>
              <th className="num">Kvitton</th>
              <th className="num">Försäljning</th>
              <th className="num">Returer</th>
              <th className="num">Netto</th>
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
                  Inga Z-rapporter än. De tas i kassan när dagen stängs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
