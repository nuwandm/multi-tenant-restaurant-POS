import { useState, type FormEvent } from 'react';
import { api, type Role } from '../api';
import { ROLE_LABELS } from '../format';
import { useT } from '../i18n';
import { useAction, useLoad } from '../useLoad';

interface Props {
  tenantId: string;
  myRole: Role;
  myUserId: string;
}

/** Staff and roles. Everyone gets a till PIN; owners and managers can also get a back office login. */
export function StaffPage({ tenantId, myRole, myUserId }: Props) {
  const t = useT();
  const { data, error, reload } = useLoad(() => api.staff(tenantId), [tenantId]);
  const action = useAction();
  const assignable: Role[] =
    myRole === 'owner' ? ['cashier', 'manager', 'owner'] : ['cashier', 'manager'];

  const update = async (userId: string, body: Parameters<typeof api.updateStaff>[2]) => {
    if (await action.run(() => api.updateStaff(tenantId, userId, body))) reload();
  };

  async function resetPin(userId: string, name: string) {
    const pin = window.prompt(t('New PIN for {name} (4–8 digits):', { name }));
    if (pin === null) return;
    if (!/^\d{4,8}$/.test(pin)) {
      window.alert(t('The PIN must be 4–8 digits.'));
      return;
    }
    await update(userId, { pin });
  }

  return (
    <section>
      <header className="page-header">
        <h1>{t('Staff')}</h1>
      </header>
      {(error || action.error) && <p className="error">{t((error ?? action.error)!)}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>{t('Name')}</th>
              <th>{t('Role')}</th>
              <th>{t('Login')}</th>
              <th>{t('Active')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.map((s) => {
              const self = s.userId === myUserId;
              const locked = s.role === 'owner' && myRole !== 'owner';
              return (
                <tr key={s.userId} className={s.active ? '' : 'muted'}>
                  <td>
                    <strong>{s.displayName}</strong>
                    {self && <span className="muted"> {t('(you)')}</span>}
                    {s.email && <div className="muted small">{s.email}</div>}
                  </td>
                  <td>
                    <select
                      value={s.role}
                      disabled={self || locked}
                      onChange={(e) => update(s.userId, { role: e.target.value as Role })}
                    >
                      {(locked ? ['owner' as Role] : assignable).map((r) => (
                        <option key={r} value={r}>
                          {t(ROLE_LABELS[r])}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="small">
                    {s.hasPin ? t('Till PIN') : <span className="muted">{t('No PIN')}</span>}
                    {s.pinLocked && <span className="badge badge-suspended">{t('Locked')}</span>}
                    {s.hasPassword && <div>Back office</div>}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={t('Active')}
                      checked={s.active}
                      disabled={self || locked}
                      onChange={(e) => update(s.userId, { active: e.target.checked })}
                    />
                  </td>
                  <td className="actions">
                    {!locked && (
                      <button
                        className="secondary small"
                        disabled={action.busy}
                        onClick={() => resetPin(s.userId, s.displayName)}
                      >
                        {s.hasPin ? t('New PIN') : t('Set PIN')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <AddStaffForm
        assignable={assignable}
        onAdd={async (body) => {
          const ok = await action.run(() => api.addStaff(tenantId, body));
          if (ok) reload();
          return ok;
        }}
        busy={action.busy}
      />
    </section>
  );
}

function AddStaffForm({
  assignable,
  onAdd,
  busy,
}: {
  assignable: Role[];
  onAdd: (body: Parameters<typeof api.addStaff>[1]) => Promise<boolean>;
  busy: boolean;
}) {
  const t = useT();
  const empty = { displayName: '', role: 'cashier' as Role, pin: '', email: '', password: '' };
  const [form, setForm] = useState(empty);
  const backOffice = form.role !== 'cashier';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await onAdd({
      displayName: form.displayName,
      role: form.role,
      pin: form.pin,
      ...(form.email && { email: form.email }),
      ...(backOffice && form.password && { password: form.password }),
    });
    if (ok) setForm(empty);
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>{t('Add staff')}</h2>
      <div className="form-grid">
        <label className="field">
          {t('Name')}
          <input
            required
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </label>
        <label className="field">
          {t('Role')}
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {assignable.map((r) => (
              <option key={r} value={r}>
                {t(ROLE_LABELS[r])}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('Till PIN')}
          <input
            required
            inputMode="numeric"
            pattern="\d{4,8}"
            title={t('4–8 digits')}
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value })}
          />
        </label>
        <label className="field">
          {backOffice ? t('Email (for the back office)') : t('Email (optional)')}
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        {backOffice && (
          <label className="field">
            {t('Back office password (optional, at least 10 characters)')}
            <input
              type="password"
              minLength={10}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
        )}
      </div>
      <div>
        <button className="primary" disabled={busy}>
          {t('Add')}
        </button>
      </div>
    </form>
  );
}
