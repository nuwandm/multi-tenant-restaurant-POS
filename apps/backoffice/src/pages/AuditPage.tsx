import { api } from '../api';
import { formatDateTime } from '../format';
import { useLoad } from '../useLoad';

const ACTION_LABELS: Record<string, string> = {
  'company.signup': 'Registrerade företaget',
  'restaurant.create': 'Lade till restaurang',
  'register.create': 'Lade till kassa',
  'register.retire': 'Avregistrerade kassa',
  'menu_group.create': 'Lade till menygrupp',
  'menu_group.update': 'Ändrade menygrupp',
  'article.create': 'Lade till rätt',
  'article.update': 'Ändrade rätt',
  'staff.create': 'Lade till personal',
  'staff.update': 'Ändrade personal',
};

/** Who changed what in the back office. The log can't be edited. */
export function AuditPage({ tenantId }: { tenantId: string }) {
  const { data, error } = useLoad(() => api.audit(tenantId), [tenantId]);
  return (
    <section>
      <header className="page-header">
        <h1>Ändringslogg</h1>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>När</th>
              <th>Vem</th>
              <th>Vad</th>
              <th>Detaljer</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((e, i) => (
              <tr key={i}>
                <td className="small">{formatDateTime(e.at)}</td>
                <td>{e.by}</td>
                <td>{ACTION_LABELS[e.action] ?? e.action}</td>
                <td className="small mono">
                  {Object.entries(e.details)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
