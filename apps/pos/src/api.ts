import type {
  PaymentMethod,
  ReceiptKind,
  ReceiptLine,
  VatRate,
  VatTotal,
  ZReportTotals,
} from '@pos/domain';
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
  originalReceiptId: string | null;
}

/** A receipt from the list endpoint, with how much of each line has been returned. */
export interface ListedReceipt extends Receipt {
  returnedQuantities: Record<number, number>;
}

export interface Report extends ZReportTotals {
  zNumber?: number;
  periodFrom: string;
  periodTo: string;
  seller: { legalName: string; orgNumber: string };
  register: { id: string; designation: string };
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

const post = <T>(path: string, body?: object) =>
  request<T>(`/registers/${REGISTER_ID}/${path}`, {
    method: 'POST',
    ...(body && { body: JSON.stringify(body) }),
  });

export const createReceipt = (receipt: NewReceipt) => post<Receipt>('receipts', receipt);

export const listReceipts = (limit = 30) =>
  request<ListedReceipt[]>(`/registers/${REGISTER_ID}/receipts?limit=${limit}`);

export const createReturn = (body: {
  originalReceiptId: string;
  lines: { lineNo: number; quantity: number }[];
  payments: { method: PaymentMethod; amountOre: number }[];
}) => post<Receipt>('returns', body);

export const createCopy = (originalReceiptId: string) =>
  post<Receipt>('copies', { originalReceiptId });

export const createXReport = () => post<Report>('x-reports');

export const createZReport = () => post<Report>('z-reports');
