import { FakeControlSystem } from '@pos/control-system';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('GET /health', () => {
  it('reports ok and the control system status', async () => {
    const controlSystem = new FakeControlSystem();
    const app = buildApp({ controlSystem });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', controlSystem: { online: true } });
  });

  it('shows when the control system is offline', async () => {
    const controlSystem = new FakeControlSystem();
    controlSystem.setOnline(false);
    const app = buildApp({ controlSystem });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.json()).toMatchObject({ controlSystem: { online: false } });
  });
});
