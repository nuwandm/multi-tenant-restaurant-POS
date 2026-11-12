import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { formatDateTime, formatOrgNumber, STATUS_LABELS } from '../format';
import { useT } from '../i18n';
import { useAction, useLoad } from '../useLoad';

/** Branches (restaurants) and their registers. Registers are retired, never deleted. */
export function RestaurantsPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { data, error, reload } = useLoad(() => api.restaurants(tenantId), [tenantId]);
  const action = useAction();
  const [newRestaurant, setNewRestaurant] = useState({ name: '', address: '' });
  const [newRegister, setNewRegister] = useState<Record<string, string>>({});
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
    designation: string;
  } | null>(null);

  async function addRestaurant(e: FormEvent) {
    e.preventDefault();
    const ok = await action.run(() =>
      api.addRestaurant(tenantId, {
        name: newRestaurant.name,
        ...(newRestaurant.address && { address: newRestaurant.address }),
      }),
    );
    if (ok) {
      setNewRestaurant({ name: '', address: '' });
      reload();
    }
  }

  async function addRegister(e: FormEvent, restaurantId: string) {
    e.preventDefault();
    const designation = newRegister[restaurantId]?.trim();
    if (!designation) return;
    if (await action.run(() => api.addRegister(tenantId, restaurantId, designation))) {
      setNewRegister((r) => ({ ...r, [restaurantId]: '' }));
      reload();
    }
  }

  async function retire(registerId: string, designation: string) {
    if (
      !window.confirm(
        t('Retire {name}? It can no longer sell. Its receipts and Z reports are kept.', {
          name: designation,
        }),
      )
    )
      return;
    if (await action.run(() => api.retireRegister(tenantId, registerId))) reload();
  }

  async function showCode(registerId: string, designation: string) {
    await action.run(async () => {
      const { code, expiresAt } = await api.pairingCode(tenantId, registerId);
      setPairing({ code, expiresAt, designation });
    });
  }

  async function revoke(deviceId: string, name: string) {
    if (
      !window.confirm(t('Unpair {name}? Anyone logged in on it is logged out at once.', { name }))
    )
      return;
    if (await action.run(() => api.revokeDevice(tenantId, deviceId))) reload();
  }

  return (
    <section>
      {pairing && (
        <PairingCodeDialog
          {...pairing}
          onClose={() => {
            setPairing(null);
            reload();
          }}
        />
      )}
      <header className="page-header">
        <h1>{t('Restaurants & registers')}</h1>
      </header>
      {data?.company && (
        <p className="muted">
          {data.company.legalName} · {formatOrgNumber(data.company.orgNumber)} · {t('Company ID')}{' '}
          <span className="mono">{tenantId}</span> ·{' '}
          <span className={`badge badge-${data.company.status}`}>
            {t(STATUS_LABELS[data.company.status])}
          </span>
        </p>
      )}
      {data?.company.status === 'pending' && (
        <p className="notice">
          {t(
            'The company is waiting for approval. You can set everything up now; the registers can sell once the company is approved.',
          )}
        </p>
      )}
      {(error || action.error) && <p className="error">{t((error ?? action.error)!)}</p>}

      {data?.restaurants.map((r) => (
        <div key={r.id} className="card">
          <div className="card-header">
            <div>
              <h2>{r.name}</h2>
              {r.address && <p className="muted small">{r.address}</p>}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('Register (designation)')}</th>
                <th>{t('Status')}</th>
                <th>{t('Control system')}</th>
                <th>{t('Paired devices')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.registers.map((c) => (
                <tr key={c.id} className={c.status === 'retired' ? 'muted' : ''}>
                  <td>
                    <strong>{c.designation}</strong>
                    <div className="muted small">
                      {t('Created {date}', { date: formatDateTime(c.createdAt) })}
                    </div>
                  </td>
                  <td>
                    {c.status === 'active'
                      ? t('Active')
                      : t('Retired {date}', {
                          date: c.retiredAt ? formatDateTime(c.retiredAt) : '',
                        })}
                  </td>
                  <td>{c.enrolled ? t('Connected') : t('Not connected')}</td>
                  <td className="small">
                    {c.devices.length === 0 && <span className="muted">{t('None')}</span>}
                    {c.devices.map((d) => (
                      <div key={d.id} className="device">
                        <span>
                          {d.name}
                          <span className="muted">
                            {' '}
                            ·{' '}
                            {d.lastSeenAt
                              ? t('last used {date}', { date: formatDateTime(d.lastSeenAt) })
                              : t('paired {date}', { date: formatDateTime(d.pairedAt) })}
                          </span>
                        </span>
                        <button
                          className="link small"
                          disabled={action.busy}
                          onClick={() => revoke(d.id, d.name)}
                        >
                          {t('Unpair')}
                        </button>
                      </div>
                    ))}
                  </td>
                  <td className="actions">
                    {c.status === 'active' && (
                      <>
                        <button
                          className="primary small"
                          disabled={action.busy}
                          onClick={() => showCode(c.id, c.designation)}
                        >
                          {t('Pair device')}
                        </button>{' '}
                        <button
                          className="secondary small"
                          disabled={action.busy}
                          onClick={() => retire(c.id, c.designation)}
                        >
                          {t('Retire')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {r.registers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t('No register yet.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <form className="inline-form" onSubmit={(e) => addRegister(e, r.id)}>
            <input
              placeholder={t('New register, e.g. TILL-2')}
              pattern="[A-Za-z0-9\-]{1,20}"
              title={t('Letters, digits and dashes, at most 20 characters')}
              value={newRegister[r.id] ?? ''}
              onChange={(e) => setNewRegister((x) => ({ ...x, [r.id]: e.target.value }))}
            />
            <button className="primary small" disabled={action.busy}>
              {t('Add register')}
            </button>
          </form>
        </div>
      ))}

      <form className="card inline-form" onSubmit={addRestaurant}>
        <strong>{t('New restaurant')}</strong>
        <input
          required
          placeholder={t('Name')}
          value={newRestaurant.name}
          onChange={(e) => setNewRestaurant((x) => ({ ...x, name: e.target.value }))}
        />
        <input
          placeholder={t('Address (optional)')}
          value={newRestaurant.address}
          onChange={(e) => setNewRestaurant((x) => ({ ...x, address: e.target.value }))}
        />
        <button className="primary small" disabled={action.busy}>
          {t('Add')}
        </button>
      </form>
    </section>
  );
}

/** The one-time code to type on the till, with a countdown until it expires. */
function PairingCodeDialog({
  code,
  expiresAt,
  designation,
  onClose,
}: {
  code: string;
  expiresAt: string;
  designation: string;
  onClose: () => void;
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('Pairing code')}>
      <div className="dialog stack center">
        <h2>{t('Pair a device with {name}', { name: designation })}</h2>
        <p className="muted small">
          {t(
            'Open the till on the tablet or computer and type in the code. The code can be used once.',
          )}
        </p>
        <p className="pairing-code">{left > 0 ? code : '––––-––––'}</p>
        <p className={left > 0 ? 'muted' : 'error'}>
          {left > 0
            ? t('Valid for {time}', { time: mmss })
            : t('The code has expired. Close and create a new one.')}
        </p>
        <button className="primary" onClick={onClose}>
          {t('Done')}
        </button>
      </div>
    </div>
  );
}
