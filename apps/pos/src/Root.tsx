import { useCallback, useEffect, useState } from 'react';
import {
  currentStaff,
  getDevice,
  logout,
  setLoggedOutHandler,
  setUnpairedHandler,
  type DeviceInfo,
  type Staff,
} from './api';
import { App } from './App';
import { LoginScreen } from './LoginScreen';
import { PairingScreen } from './PairingScreen';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Pair the device first, then a staff member logs in, then the till. */
export function Root() {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const info = await getDevice();
      setDevice(info);
      setStaff(info ? await currentStaff() : null);
    } catch (err) {
      setError(message(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    setLoggedOutHandler(() => setStaff(null));
    setUnpairedHandler(() => {
      setStaff(null);
      setDevice(null);
    });
    void start();
  }, [start]);

  if (checking) return <div className="center-message">Laddar…</div>;
  if (error) {
    return (
      <div className="center-message">
        <h1>Kassan kunde inte startas</h1>
        <p>{error}</p>
        <button className="primary" onClick={() => void start()}>
          Försök igen
        </button>
      </div>
    );
  }
  if (!device) return <PairingScreen onPaired={() => void start()} />;
  if (!staff) return <LoginScreen device={device} onLoggedIn={setStaff} />;
  return (
    <App
      staff={staff}
      companyStatus={device.company.status}
      onLogout={() => {
        void logout().finally(() => setStaff(null));
      }}
    />
  );
}
