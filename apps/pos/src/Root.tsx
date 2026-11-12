import { useEffect, useState } from 'react';
import { currentStaff, logout, setLoggedOutHandler, type Staff } from './api';
import { App } from './App';
import { LoginScreen } from './LoginScreen';

/** Shows the login screen until a staff member is logged in on this register. */
export function Root() {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setLoggedOutHandler(() => setStaff(null));
    currentStaff()
      .then(setStaff)
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="center-message">Laddar…</div>;
  if (!staff) return <LoginScreen onLoggedIn={setStaff} />;
  return (
    <App
      staff={staff}
      onLogout={() => {
        void logout().finally(() => setStaff(null));
      }}
    />
  );
}
