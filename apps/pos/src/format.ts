import type { PaymentMethod } from '@pos/domain';

const sek = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' });

/** 14900 -> "149,00 kr" */
export function formatKr(ore: number): string {
  return sek.format(ore / 100);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  card: 'Kort',
  cash: 'Kontant',
  swish: 'Swish',
  gift_card: 'Presentkort',
};
