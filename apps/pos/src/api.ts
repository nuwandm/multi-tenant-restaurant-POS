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
  cashier: { id: string; displayName: string } | null;
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

/** Staff-facing Swedish text for the API's error codes; other errors show the API message. */
const ERROR_TEXT: Record<string, string> = {
  invalid_pin: 'Fel PIN-kod.',
  pin_locked: 'För många felaktiga försök. Vänta 5 minuter och försök igen.',
  not_logged_in: 'Du är utloggad. Logga in igen.',
  forbidden: 'Endast chef eller ägare får göra detta.',
  wrong_register: 'Du är inloggad på en annan kassa.',
  control_system_unavailable: 'Kontrollsystemet svarar inte. Inget kvitto skapades.',
  register_retired: 'Kassan är avregistrerad.',
  article_unavailable: 'En vara finns inte längre i menyn. Töm ordern och försök igen.',
};

const TOKEN_KEY = 'pos.sessionToken';

// The session token is kept per device so a page reload doesn't log the cashier out.
let token: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();

function setToken(value: string | null) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the session just won't survive a reload.
  }
}

let onLoggedOut: () => void = () => {};

/** Called when the API says the session is gone (expired, logged out elsewhere). */
export function setLoggedOutHandler(handler: () => void) {
  onLoggedOut = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        'x-tenant-id': TENANT_ID,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new ApiError('Ingen kontakt med servern. Kontrollera att API:t körs (pnpm dev:api).');
  }
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && body?.error === 'not_logged_in' && token) {
      setToken(null);
      onLoggedOut();
    }
    const text =
      (body?.error && ERROR_TEXT[body.error]) ?? body?.message ?? `Serverfel (${res.status})`;
    throw new ApiError(text, body?.error);
  }
  return body as T;
}

export type Role = 'owner' | 'manager' | 'cashier';

export interface Staff {
  userId: string;
  displayName: string;
  role: Role;
}

export interface LoginInfo {
  register: { id: string; designation: string; status: string };
  restaurant: { name: string };
  staff: Staff[];
}

export const getLoginInfo = () => request<LoginInfo>(`/registers/${REGISTER_ID}/login-info`);

export async function login(userId: string, pin: string): Promise<Staff> {
  const res = await request<{ token: string; staff: Staff }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ registerId: REGISTER_ID, userId, pin }),
  });
  setToken(res.token);
  return res.staff;
}

/** The logged-in staff member, or null if there is no valid session on this device. */
export async function currentStaff(): Promise<Staff | null> {
  if (!token) return null;
  try {
    const res = await request<{ staff: Staff; registerId: string }>('/auth/session');
    if (res.registerId === REGISTER_ID) return res.staff;
  } catch {
    // Fall through to logged out.
  }
  setToken(null);
  return null;
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/auth/logout', { method: 'POST' });
  } finally {
    setToken(null);
  }
}

export const isManager = (staff: Staff) => staff.role === 'owner' || staff.role === 'manager';

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
