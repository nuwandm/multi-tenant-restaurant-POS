import type { PaymentMethod, ReceiptKind, ReceiptLine, VatRate, VatTotal } from '@pos/domain';
import { REGISTER_ID, TENANT_ID } from './config';

export interface Article {
  id: string;
  name: string;
  priceOre: number;
  vatRate: VatRate;
}

export interface Menu {
  register: { id: string; designation: string; status: 'active' | 'retired' };
  restaurant: { name: string };
  seller: { legalName: string; orgNumber: string };
  groups: { name: string; articles: Article[] }[];
}

export interface Receipt {
  id: string;
  kind: ReceiptKind;
  receiptNumber: number;
  createdAt: string;
  controlCode: string;
  seller: { legalName: string; orgNumber: string };
  register: { id: string; designation: string };
  lines: ReceiptLine[];
  vatTotals: VatTotal[];
  totalOre: number;
  cashRoundingOre: number;
  payments: { method: PaymentMethod; amountOre: number }[];
}

export interface NewReceipt {
  kind: 'sale' | 'training';
  lines: { articleId: string; quantity: number }[];
  payments: { method: PaymentMethod; amountOre: number }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        'x-tenant-id': TENANT_ID,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new ApiError('Ingen kontakt med servern. Kontrollera att API:t körs (pnpm dev:api).');
  }
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) throw new ApiError(body?.message ?? `Serverfel (${res.status})`, body?.error);
  return body as T;
}

export const getHealth = () =>
  request<{ status: string; controlSystem: { online: boolean } }>('/health');

export const getMenu = () => request<Menu>(`/registers/${REGISTER_ID}/menu`);

export const createReceipt = (receipt: NewReceipt) =>
  request<Receipt>(`/registers/${REGISTER_ID}/receipts`, {
    method: 'POST',
    body: JSON.stringify(receipt),
  });
