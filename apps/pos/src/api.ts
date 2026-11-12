import type {
  PaymentMethod,
  ReceiptKind,
  ReceiptLine,
  VatRate,
  VatTotal,
  ZReportTotals,
} from '@pos/domain';

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
  company_pending:
    'Företaget väntar på godkännande och kan inte sälja än. Träna gärna under tiden.',
  company_suspended: 'Företaget är avstängt och kan inte sälja.',
  invalid_pairing_code: 'Koden är fel, använd eller har gått ut. Skapa en ny i back office.',
  device_not_paired: 'Den här enheten är inte kopplad till någon kassa.',
};

// Kept per device: the device token (which register this is) and the staff session token.
const DEVICE_KEY = 'pos.deviceToken';
const SESSION_KEY = 'pos.sessionToken';

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: pairing and login just won't survive a reload.
  }
}

let deviceToken = load(DEVICE_KEY);
let token = load(SESSION_KEY);
/** Set from GET /device; every register-scoped call uses it. */
let registerId = '';

function setToken(value: string | null) {
  token = value;
  store(SESSION_KEY, value);
}

function setDeviceToken(value: string | null) {
  deviceToken = value;
  store(DEVICE_KEY, value);
  if (!value) setToken(null);
}

export const isPaired = () => deviceToken !== null;

let onLoggedOut: () => void = () => {};
let onUnpaired: () => void = () => {};

/** Called when the API says the session is gone (expired, logged out elsewhere). */
export function setLoggedOutHandler(handler: () => void) {
  onLoggedOut = handler;
}

/** Called when the device has been revoked in the back office. */
export function setUnpairedHandler(handler: () => void) {
  onUnpaired = handler;
}

async function request<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(deviceToken ? { 'x-device-token': deviceToken } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
      },
    });
  } catch {
    throw new ApiError('Ingen kontakt med servern. Kontrollera nätverket och försök igen.');
  }
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && body?.error === 'device_not_paired' && deviceToken) {
      setDeviceToken(null);
      onUnpaired();
    } else if (res.status === 401 && body?.error === 'not_logged_in' && token) {
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

export interface DeviceInfo {
  device: { id: string; name: string };
  register: { id: string; designation: string; status: string };
  restaurant: { name: string };
  company: { legalName: string; status: 'pending' | 'active' | 'suspended' };
  staff: Staff[];
}

/** Uses a pairing code from the back office. The device is this register from then on. */
export async function pairDevice(code: string, name: string): Promise<void> {
  const res = await request<{ deviceToken: string }>('/devices/pair', {
    method: 'POST',
    body: JSON.stringify({ code, name }),
  });
  setDeviceToken(res.deviceToken);
}

/** Which register this device is, its company and who can log in. Null if not paired. */
export async function getDevice(): Promise<DeviceInfo | null> {
  if (!deviceToken) return null;
  try {
    const info = await request<DeviceInfo>('/device');
    registerId = info.register.id;
    return info;
  } catch (err) {
    if (err instanceof ApiError && err.code === 'device_not_paired') return null;
    throw err;
  }
}

export async function login(userId: string, pin: string): Promise<Staff> {
  const res = await request<{ token: string; staff: Staff }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId, pin }),
  });
  setToken(res.token);
  return res.staff;
}

/** The logged-in staff member, or null if there is no valid session on this device. */
export async function currentStaff(): Promise<Staff | null> {
  if (!token) return null;
  try {
    const res = await request<{ staff: Staff; registerId: string }>('/auth/session');
    if (res.registerId === registerId) return res.staff;
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

export const getMenu = () => request<Menu>(`/registers/${registerId}/menu`);

/** A new key per payment attempt; reuse it when retrying the same attempt. */
export const newAttemptKey = () => crypto.randomUUID();

const post = <T>(path: string, body?: object, idempotencyKey?: string) =>
  request<T>(`/registers/${registerId}/${path}`, {
    method: 'POST',
    ...(body && { body: JSON.stringify(body) }),
    ...(idempotencyKey && { idempotencyKey }),
  });

export const createReceipt = (receipt: NewReceipt, idempotencyKey: string) =>
  post<Receipt>('receipts', receipt, idempotencyKey);

export const listReceipts = (limit = 30) =>
  request<ListedReceipt[]>(`/registers/${registerId}/receipts?limit=${limit}`);

export const createReturn = (
  body: {
    originalReceiptId: string;
    lines: { lineNo: number; quantity: number }[];
    payments: { method: PaymentMethod; amountOre: number }[];
  },
  idempotencyKey: string,
) => post<Receipt>('returns', body, idempotencyKey);

export const createCopy = (originalReceiptId: string, idempotencyKey: string) =>
  post<Receipt>('copies', { originalReceiptId }, idempotencyKey);

export const createXReport = () => post<Report>('x-reports');

export const createZReport = () => post<Report>('z-reports');
