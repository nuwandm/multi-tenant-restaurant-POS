import type {
  PaymentMethod,
  ReceiptKind,
  ReceiptLine,
  VatRate,
  VatTotal,
  ZReportTotals,
} from '@pos/domain';

export type Station = 'kitchen' | 'bar';

export interface OptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { id: string; name: string; priceDeltaOre: number }[];
}

export interface Article {
  id: string;
  name: string;
  priceOre: number;
  vatRate: VatRate;
  station: Station | null;
  optionGroups: OptionGroup[];
}

export interface DiningTable {
  id: string;
  name: string;
}

export interface Menu {
  register: { id: string; designation: string; status: 'active' | 'retired' };
  restaurant: { name: string };
  seller: { legalName: string; orgNumber: string };
  /** name is null for items without a group. */
  groups: { name: string | null; articles: Article[] }[];
  tables: DiningTable[];
}

/** What the till sends for a line. Prices always come from the server. */
export interface LineRequest {
  articleId: string;
  quantity: number;
  optionIds?: string[];
  discountOre?: number;
}

/** A line on an open order, priced by the server. */
export interface OrderLine {
  key: string;
  articleId: string;
  name: string;
  options?: string;
  optionIds: string[];
  quantity: number;
  unitPriceOre: number;
  vatRate: VatRate;
  discountOre?: number;
  station: Station | null;
  sentQuantity: number;
}

export interface OpenOrder {
  id: string;
  tableId: string | null;
  tableName: string | null;
  lines: OrderLine[];
  orderDiscountOre: number;
  totalOre: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface KitchenTicket {
  id: string;
  station: Station;
  ticketNo: number;
  label: string;
  training: boolean;
  createdAt: string;
  doneAt: string | null;
  lines: { name: string; options: string | null; quantity: number }[];
  createdBy: string;
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
  lines: LineRequest[];
  orderDiscountOre?: number;
  payments: { method: PaymentMethod; amountOre: number }[];
  openOrderId?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Staff-facing text for the API's error codes, translated with t() where shown. */
const ERROR_TEXT: Record<string, string> = {
  invalid_pin: 'Wrong PIN.',
  pin_locked: 'Too many wrong PINs. Wait 5 minutes and try again.',
  not_logged_in: 'You are logged out. Please log in again.',
  forbidden: 'Only a manager or owner can do this.',
  wrong_register: 'You are logged in on another register.',
  control_system_unavailable: 'The control system is not responding. No receipt was created.',
  register_retired: 'This register is retired.',
  article_unavailable: 'An item is no longer on the menu. Clear the order and try again.',
  option_unavailable: 'An option is no longer available. Remove the item and add it again.',
  option_choice: 'An item is missing a required choice. Remove it and add it again.',
  table_busy: 'This table already has an open order.',
  order_changed: 'Someone else changed this order. It has been reloaded.',
  order_closed: 'This order is already closed.',
  invalid_discount: 'The discount is larger than the amount.',
  company_pending:
    'The company is waiting for approval and cannot sell yet. Use training mode meanwhile.',
  company_suspended: 'The company is suspended and cannot sell.',
  invalid_pairing_code: 'The code is wrong, used or expired. Create a new one in the back office.',
  device_not_paired: 'This device is not paired with a register.',
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
    throw new ApiError('Cannot reach the server. Check the network and try again.');
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
      (body?.error && ERROR_TEXT[body.error]) ?? body?.message ?? `Server error (${res.status})`;
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

export const listOpenOrders = () => request<OpenOrder[]>(`/registers/${registerId}/open-orders`);

export const createOpenOrder = (body: {
  tableId: string | null;
  lines: LineRequest[];
  orderDiscountOre?: number;
}) => post<OpenOrder>('open-orders', body);

export const updateOpenOrder = (
  orderId: string,
  body: { lines: LineRequest[]; orderDiscountOre?: number; version: number },
) =>
  request<OpenOrder>(`/registers/${registerId}/open-orders/${orderId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const sendOpenOrder = (orderId: string) =>
  post<{ tickets: number; order: OpenOrder }>(`open-orders/${orderId}/send`);

export const cancelOpenOrder = (orderId: string) => post<void>(`open-orders/${orderId}/cancel`);

export const listKitchenTickets = (station?: Station) =>
  request<KitchenTicket[]>(
    `/registers/${registerId}/kitchen-tickets${station ? `?station=${station}` : ''}`,
  );

export const setTicketDone = (ticketId: string, done: boolean) =>
  post<{ id: string; done: boolean }>(`kitchen-tickets/${ticketId}`, { done });
