import { useEffect, useState } from 'react';

type Health = { status: string; controlSystem: { online: boolean } };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Kassa</h1>
      {error && <p>API unreachable: {error}</p>}
      {health && (
        <p>
          API {health.status} · control system {health.controlSystem.online ? 'online' : 'OFFLINE'}
        </p>
      )}
    </main>
  );
}
