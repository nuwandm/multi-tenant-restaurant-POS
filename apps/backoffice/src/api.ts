import type { VatRate } from '@pos/domain';

export type Role = 'owner' | 'manager' | 'cashier';
export type CompanyStatus = 'pending' | 'active' | 'suspended';

export interface Company {
  tenantId: string;
  legalName: string;
  orgNumber: string;
  role: Role;
}

export interface Me {
  user: { userId: string; displayName: string; email: string | null; emailVerified: boolean };
  isPlatformAdmin: boolean;
  companies: Company[];
}

export interface Register {
  id: string;
  designation: string;
  status: 'active' | 'retired';
  enrolled: boolean;
  createdAt: string;
  retiredAt: string | null;
  devices: { id: string; name: string; pairedAt: string; lastSeenAt: string | null }[];
}

export interface Restaurant {
  id: string;
  name: string;
  address: string | null;
  registers: Register[];
}

export interface MenuGroup {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface Article {
  id: string;
  name: string;
  priceOre: number;
  vatRate: VatRate;
  menuGroupId: string | null;
  active: boolean;
}

export interface StaffMember {
  userId: string;
  displayName: string;
  email: string | null;
  role: Role;
  active: boolean;
  hasPin: boolean;
  hasPassword: boolean;
  pinLocked: boolean;
}

export interface Overview {
  date: string;
  netOre: number;
  companies: (Company & {
    netOre: number;
    restaurants: { id: string; name: string; netOre: number; sales: number; returns: number }[];
  })[];
}

export interface ZReportRow {
  id: string;
  zNumber: number;
  register: string;
  restaurant: string;
  periodFrom: string;
  periodTo: string;
  saleCount: number;
  salesTotalOre: number;
  returnsTotalOre: number;
  netTotalOre: number;
  grandTotalOre: number;
}

export interface AuditEntry {
  action: string;
  entityId: string | null;
  details: Record<string, unknown>;
  at: string;
  by: string;
}

export interface PlatformCompany {
  tenantId: string;
  legalName: string;
  orgNumber: string;
  status: CompanyStatus;
  createdAt: string;
  statusChangedAt: string | null;
  owner: { name: string; email: string | null; emailVerified: boolean } | null;
  devices: number;
  restaurants: number;
  registers: number;
  activeRegisters: number;
  staff: number;
  lastSaleAt: string | null;
  sales30dOre: number;
}

const ERROR_TEXT: Record<string, string> = {
  invalid_login: 'Wrong email or password.',
  login_locked: 'Too many failed attempts. Wait 15 minutes.',
  no_backoffice_access: 'This account has no back office access.',
  not_logged_in: 'You are logged out. Please log in again.',
  email_taken: 'An account with this email already exists.',
  org_number_taken: 'This company is already registered.',
  invalid_org_number: 'That organisation number is not valid.',
  designation_taken: 'That register name is already used.',
  forbidden: 'You are not allowed to do this.',
  cannot_change_self: 'You cannot deactivate yourself or change your own role.',
  cashier_no_password: 'Cashiers use the till only and get no password.',
  invalid_token: 'The link is wrong, already used or expired.',
  register_not_found: 'The register does not exist or is retired.',
  company_not_found: 'Company not found.',
};

const TOKEN_KEY = 'backoffice.token';

let token: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();

export function setToken(value: string | null) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the login just won't survive a reload.
  }
}

export const hasToken = () => token !== null;

let onLoggedOut: () => void = () => {};
export function setLoggedOutHandler(handler: () => void) {
  onLoggedOut = handler;
}

async function request<T>(method: string, path: string, body?: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Cannot reach the server. Check that the API is running (pnpm dev:api).');
  }
  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && data?.error === 'not_logged_in' && token) {
      setToken(null);
      onLoggedOut();
    }
    throw new Error(
      (data?.error && ERROR_TEXT[data.error]) ?? data?.message ?? `Server error (${res.status})`,
    );
  }
  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: object) => request<T>('POST', path, body);
const patch = <T>(path: string, body: object) => request<T>('PATCH', path, body);
const t = (tenantId: string) => `/admin/tenants/${tenantId}`;

export const api = {
  async login(email: string, password: string) {
    setToken((await post<{ token: string }>('/admin/login', { email, password })).token);
  },
  async signup(body: {
    ownerName: string;
    email: string;
    password: string;
    legalName: string;
    orgNumber: string;
    restaurantName: string;
    restaurantAddress?: string;
  }) {
    setToken((await post<{ token: string }>('/signup', body)).token);
  },
  async logout() {
    try {
      await post('/admin/logout');
    } finally {
      setToken(null);
    }
  },
  me: () => get<Me>('/admin/me'),
  resendVerification: () => post('/admin/resend-verification'),
  verifyEmail: (token: string) => post('/admin/verify-email', { token }),
  requestPasswordReset: (email: string) => post('/admin/password-reset', { email }),
  confirmPasswordReset: (token: string, password: string) =>
    post('/admin/password-reset/confirm', { token, password }),
  addCompany: (body: { legalName: string; orgNumber: string; restaurantName: string }) =>
    post<{ tenantId: string }>('/admin/companies', body),
  overview: (date?: string) => get<Overview>(`/admin/overview${date ? `?date=${date}` : ''}`),

  restaurants: (tenantId: string) =>
    get<{
      company: { legalName: string; orgNumber: string; status: CompanyStatus };
      restaurants: Restaurant[];
    }>(`${t(tenantId)}/restaurants`),
  addRestaurant: (tenantId: string, body: { name: string; address?: string }) =>
    post(`${t(tenantId)}/restaurants`, body),
  addRegister: (tenantId: string, restaurantId: string, designation: string) =>
    post(`${t(tenantId)}/restaurants/${restaurantId}/registers`, { designation }),
  retireRegister: (tenantId: string, registerId: string) =>
    post(`${t(tenantId)}/registers/${registerId}/retire`),
  pairingCode: (tenantId: string, registerId: string) =>
    post<{ code: string; expiresAt: string }>(
      `${t(tenantId)}/registers/${registerId}/pairing-code`,
    ),
  revokeDevice: (tenantId: string, deviceId: string) =>
    post(`${t(tenantId)}/devices/${deviceId}/revoke`),

  menu: (tenantId: string, restaurantId: string) =>
    get<{ groups: MenuGroup[]; articles: Article[] }>(
      `${t(tenantId)}/restaurants/${restaurantId}/menu`,
    ),
  addGroup: (tenantId: string, restaurantId: string, body: { name: string; sortOrder?: number }) =>
    post(`${t(tenantId)}/restaurants/${restaurantId}/menu-groups`, body),
  updateGroup: (tenantId: string, groupId: string, body: Partial<Omit<MenuGroup, 'id'>>) =>
    patch(`${t(tenantId)}/menu-groups/${groupId}`, body),
  addArticle: (
    tenantId: string,
    restaurantId: string,
    body: { name: string; priceOre: number; vatRate: VatRate; menuGroupId: string | null },
  ) => post(`${t(tenantId)}/restaurants/${restaurantId}/articles`, body),
  updateArticle: (tenantId: string, articleId: string, body: Partial<Omit<Article, 'id'>>) =>
    patch(`${t(tenantId)}/articles/${articleId}`, body),

  staff: (tenantId: string) => get<StaffMember[]>(`${t(tenantId)}/staff`),
  addStaff: (
    tenantId: string,
    body: { displayName: string; email?: string; role: Role; pin: string; password?: string },
  ) => post(`${t(tenantId)}/staff`, body),
  updateStaff: (
    tenantId: string,
    userId: string,
    body: { displayName?: string; role?: Role; active?: boolean; pin?: string },
  ) => patch(`${t(tenantId)}/staff/${userId}`, body),

  zReports: (tenantId: string) => get<ZReportRow[]>(`${t(tenantId)}/z-reports`),
  audit: (tenantId: string) => get<AuditEntry[]>(`${t(tenantId)}/audit`),

  platformCompanies: () => get<PlatformCompany[]>('/platform/companies'),
  setCompanyStatus: (tenantId: string, action: 'approve' | 'suspend' | 'reactivate') =>
    post(`/platform/companies/${tenantId}/${action}`),
};
