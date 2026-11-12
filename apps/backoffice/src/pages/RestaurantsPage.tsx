import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { formatDateTime, formatOrgNumber, STATUS_LABELS } from '../format';
import { useAction, useLoad } from '../useLoad';

/** Branches (restaurants) and their registers. Registers are retired, never deleted. */
export function RestaurantsPage({ tenantId }: { tenantId: string }) {
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
        `Avregistrera ${designation}? Kassan kan inte sälja mer. Kvitton och Z-rapporter sparas.`,
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
    if (!window.confirm(`Koppla bort ${name}? Den som är inloggad där loggas ut direkt.`)) return;
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
        <h1>Restauranger & kassor</h1>
      </header>
      {data?.company && (
        <p className="muted">
          {data.company.legalName} · {formatOrgNumber(data.company.orgNumber)} · Företags-ID{' '}
          <span className="mono">{tenantId}</span> ·{' '}
          <span className={`badge badge-${data.company.status}`}>
            {STATUS_LABELS[data.company.status]}
          </span>
        </p>
      )}
      {data?.company.status === 'pending' && (
        <p className="notice">
          Företaget väntar på godkännande. Du kan lägga upp allt redan nu; kassorna kan sälja när
          företaget är godkänt.
        </p>
      )}
      {(error || action.error) && <p className="error">{error ?? action.error}</p>}

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
                <th>Kassa (kassabeteckning)</th>
                <th>Status</th>
                <th>Kontrollsystem</th>
                <th>Kopplade enheter</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.registers.map((c) => (
                <tr key={c.id} className={c.status === 'retired' ? 'muted' : ''}>
                  <td>
                    <strong>{c.designation}</strong>
                    <div className="muted small">Skapad {formatDateTime(c.createdAt)}</div>
                  </td>
                  <td>
                    {c.status === 'active'
                      ? 'Aktiv'
                      : `Avregistrerad ${c.retiredAt ? formatDateTime(c.retiredAt) : ''}`}
                  </td>
                  <td>{c.enrolled ? 'Ansluten' : 'Ej ansluten'}</td>
                  <td className="small">
                    {c.devices.length === 0 && <span className="muted">Ingen</span>}
                    {c.devices.map((d) => (
                      <div key={d.id} className="device">
                        <span>
                          {d.name}
                          <span className="muted">
                            {' '}
                            ·{' '}
                            {d.lastSeenAt
                              ? `senast ${formatDateTime(d.lastSeenAt)}`
                              : `kopplad ${formatDateTime(d.pairedAt)}`}
                          </span>
                        </span>
                        <button
                          className="link small"
                          disabled={action.busy}
                          onClick={() => revoke(d.id, d.name)}
                        >
                          Koppla bort
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
                          Koppla enhet
                        </button>{' '}
                        <button
                          className="secondary small"
                          disabled={action.busy}
                          onClick={() => retire(c.id, c.designation)}
                        >
                          Avregistrera
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {r.registers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Ingen kassa än.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <form className="inline-form" onSubmit={(e) => addRegister(e, r.id)}>
            <input
              placeholder="Ny kassa, t.ex. KASSA-2"
              pattern="[A-Za-z0-9\-]{1,20}"
              title="Bokstäver, siffror och bindestreck, högst 20 tecken"
              value={newRegister[r.id] ?? ''}
              onChange={(e) => setNewRegister((x) => ({ ...x, [r.id]: e.target.value }))}
            />
            <button className="primary small" disabled={action.busy}>
              Lägg till kassa
            </button>
          </form>
        </div>
      ))}

      <form className="card inline-form" onSubmit={addRestaurant}>
        <strong>Ny restaurang</strong>
        <input
          required
          placeholder="Namn"
          value={newRestaurant.name}
          onChange={(e) => setNewRestaurant((x) => ({ ...x, name: e.target.value }))}
        />
        <input
          placeholder="Adress (valfritt)"
          value={newRestaurant.address}
          onChange={(e) => setNewRestaurant((x) => ({ ...x, address: e.target.value }))}
        />
        <button className="primary small" disabled={action.busy}>
          Lägg till
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Kopplingskod">
      <div className="dialog stack center">
        <h2>Koppla en enhet till {designation}</h2>
        <p className="muted small">
          Öppna kassan på surfplattan eller datorn och skriv in koden. Koden kan bara användas en
          gång.
        </p>
        <p className="pairing-code">{left > 0 ? code : '––––-––––'}</p>
        <p className={left > 0 ? 'muted' : 'error'}>
          {left > 0 ? `Gäller i ${mmss}` : 'Koden har gått ut. Stäng och skapa en ny.'}
        </p>
        <button className="primary" onClick={onClose}>
          Klar
        </button>
      </div>
    </div>
  );
}
