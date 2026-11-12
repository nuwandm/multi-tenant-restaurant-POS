import { api } from '../api';
import { formatDateTime } from '../format';
import { useT } from '../i18n';
import { useLoad } from '../useLoad';

const ACTION_LABELS: Record<string, string> = {
  'company.signup': 'Registered the company',
  'restaurant.create': 'Added a restaurant',
  'register.create': 'Added a register',
  'register.retire': 'Retired a register',
  'menu_group.create': 'Added a menu group',
  'menu_group.update': 'Changed a menu group',
  'article.create': 'Added an item',
  'article.update': 'Changed an item',
  'staff.create': 'Added staff',
  'staff.update': 'Changed staff',
};

/** Who changed what in the back office. The log can't be edited. */
export function AuditPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { data, error } = useLoad(() => api.audit(tenantId), [tenantId]);
  return (
    <section>
      <header className="page-header">
        <h1>{t('Change log')}</h1>
      </header>
      {error && <p className="error">{t(error)}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>{t('When')}</th>
              <th>{t('Who')}</th>
              <th>{t('What')}</th>
              <th>{t('Details')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((e, i) => (
              <tr key={i}>
                <td className="small">{formatDateTime(e.at)}</td>
                <td>{e.by}</td>
                <td>{ACTION_LABELS[e.action] ? t(ACTION_LABELS[e.action]!) : e.action}</td>
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
