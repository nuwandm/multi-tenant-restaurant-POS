import type { CompanyStatus, Role } from './api';

const sek = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' });

export const formatKr = (ore: number) => sek.format(ore / 100);

/** "149,50" or "149.50" -> 14950; null if not a valid amount. */
export function parseKr(input: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

export const formatOrgNumber = (n: string) => n.replace(/^(\d{6})/, '$1-');

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
};

export const STATUS_LABELS: Record<CompanyStatus, string> = {
  pending: 'Waiting for approval',
  active: 'Active',
  suspended: 'Suspended',
};

export const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
