import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import QRCode from 'qrcode';

export type SwishStatus = 'pending' | 'paid' | 'declined' | 'cancelled' | 'error';

export interface SwishPaymentRequest {
  /** Our id for the request: 32 upper-case hex characters (Swish's "instruction UUID"). */
  instructionId: string;
  /** The restaurant's Swish number, 123xxxxxxx. */
  payee: string;
  amountOre: number;
  /** Shown to the guest in the Swish app; at most 50 characters. */
  message: string;
  /** Appended to the callback base URL so the callback finds this request again. */
  callbackPath: string;
}

export interface SwishState {
  status: SwishStatus;
  errorCode?: string;
  paidAt?: Date;
  /** Swish's reference for a paid payment; a refund quotes it. */
  paymentReference?: string;
}

export interface SwishRefundRequest {
  instructionId: string;
  /** Swish's reference of the payment the money goes back from. */
  originalPaymentReference: string;
  /** The restaurant's Swish number: the refund is paid from it. */
  payer: string;
  amountOre: number;
  message: string;
  callbackPath: string;
}

/** Swish Handel, m-commerce flow: a payment request without a payer, paid by scanning a QR code. */
export interface SwishClient {
  /** True for the built-in simulator: the till may then simulate the guest paying. */
  readonly simulated: boolean;
  create(request: SwishPaymentRequest): Promise<{ token: string }>;
  status(instructionId: string): Promise<SwishState>;
  /** Cancels a request the guest hasn't paid yet. Returns the state after trying. */
  cancel(instructionId: string): Promise<SwishState>;
  /** The QR code the guest scans, as SVG. */
  qrSvg(token: string): Promise<string>;
  /** Gives money back from a paid payment. No guest action is needed. */
  refund(request: SwishRefundRequest): Promise<void>;
  refundStatus(instructionId: string): Promise<SwishState>;
}

/** Swish answered with an error, e.g. the payee isn't enrolled (ACMT03) or a bad amount (AM02). */
export class SwishError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Swish wants "245.00", never a float. */
export const swishAmount = (amountOre: number) =>
  `${Math.floor(amountOre / 100)}.${String(amountOre % 100).padStart(2, '0')}`;

/** Swish allows only letters, digits, spaces and a few signs in the message. */
export const swishMessage = (text: string) =>
  text
    .replace(/[^a-zA-Z0-9åäöÅÄÖ :;.,?!()"-]/g, '')
    .trim()
    .slice(0, 50);

/** A payment request id in the shape Swish wants, made from our uuid. */
export const instructionId = (uuid: string) => uuid.replace(/-/g, '').toUpperCase();

const STATUS: Record<string, SwishStatus> = {
  CREATED: 'pending',
  PAID: 'paid',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  ERROR: 'error',
};

// ---------------------------------------------------------------------------------------------

/** Swish's refund states: the money has left the restaurant once it is DEBITED. */
const REFUND_STATUS: Record<string, SwishStatus> = {
  CREATED: 'pending',
  VALIDATED: 'pending',
  DEBITED: 'paid',
  PAID: 'paid',
  ERROR: 'error',
};

/** Swish requests time out after three minutes if the guest doesn't pay. */
const SIMULATED_TIMEOUT_MS = 3 * 60_000;

/**
 * In-memory Swish for development and tests. Nothing leaves the machine; the till shows a
 * "simulate" button instead of waiting for a real phone.
 */
export class SimulatedSwish implements SwishClient {
  readonly simulated = true;
  private readonly requests = new Map<
    string,
    { state: SwishState; createdAt: number; payee: string; amountOre: number }
  >();
  private readonly refunds = new Map<
    string,
    { state: SwishState; ref: string; amountOre: number }
  >();

  async create(request: SwishPaymentRequest) {
    if (request.amountOre < 100) throw new SwishError('AM06', 'The amount is below 1 kr');
    this.requests.set(request.instructionId, {
      state: { status: 'pending' },
      createdAt: Date.now(),
      payee: request.payee,
      amountOre: request.amountOre,
    });
    return { token: randomUUID().replace(/-/g, '') };
  }

  async status(id: string): Promise<SwishState> {
    const r = this.requests.get(id);
    if (!r) throw new SwishError('RP04', 'No such payment request');
    if (r.state.status === 'pending' && Date.now() - r.createdAt > SIMULATED_TIMEOUT_MS) {
      r.state = { status: 'error', errorCode: 'TM01' };
    }
    return r.state;
  }

  async cancel(id: string): Promise<SwishState> {
    const state = await this.status(id);
    if (state.status !== 'pending') return state;
    const r = this.requests.get(id)!;
    r.state = { status: 'cancelled' };
    return r.state;
  }

  async qrSvg(token: string) {
    return QRCode.toString(`D${token}`, { type: 'svg', margin: 0 });
  }

  /** Refunds are checked like Swish does: the payment exists, and refunds never exceed it. */
  async refund(request: SwishRefundRequest) {
    const original = [...this.requests.values()].find(
      (r) => r.state.paymentReference === request.originalPaymentReference,
    );
    if (!original) throw new SwishError('RF02', 'Original payment not found');
    if (original.payee !== request.payer) {
      throw new SwishError('RF03', 'The payer is not the payee of the original payment');
    }
    const refunded = [...this.refunds.values()]
      .filter((r) => r.ref === request.originalPaymentReference && r.state.status !== 'error')
      .reduce((sum, r) => sum + r.amountOre, 0);
    if (refunded + request.amountOre > original.amountOre) {
      throw new SwishError('RF08', 'The refund exceeds the original payment');
    }
    this.refunds.set(request.instructionId, {
      state: { status: 'pending' },
      ref: request.originalPaymentReference,
      amountOre: request.amountOre,
    });
  }

  /** A simulated refund goes through on the first check after it was made. */
  async refundStatus(id: string): Promise<SwishState> {
    const r = this.refunds.get(id);
    if (!r) throw new SwishError('RF04', 'No such refund');
    if (r.state.status === 'pending') r.state = { status: 'paid', paidAt: new Date() };
    return r.state;
  }

  /** What the guest's phone would do. */
  simulate(id: string, outcome: 'paid' | 'declined') {
    const r = this.requests.get(id);
    if (!r || r.state.status !== 'pending') return false;
    r.state =
      outcome === 'paid'
        ? {
            status: 'paid',
            paidAt: new Date(),
            paymentReference: randomUUID().replace(/-/g, '').toUpperCase(),
          }
        : { status: 'declined' };
    return true;
  }
}

// ---------------------------------------------------------------------------------------------

export interface SwishHttpConfig {
  /** https://mss.cpc.getswish.net/swish-cpcapi (test) or https://cpc.getswish.net/swish-cpcapi. */
  baseUrl: string;
  qrUrl: string;
  /** The client certificate and key from Swish Certificate Management, as a .p12 file. */
  pfx: Buffer;
  passphrase: string;
  /** Swish's root CA, if the system trust store doesn't have it. */
  ca?: Buffer;
  /** Public HTTPS URL that reaches POST /swish/callback on this API. */
  callbackBase: string;
}

interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** The real Swish Commerce API over mutual TLS. */
export class HttpSwish implements SwishClient {
  readonly simulated = false;

  constructor(private readonly config: SwishHttpConfig) {}

  async create(r: SwishPaymentRequest) {
    const res = await this.call('PUT', `/api/v2/paymentrequests/${r.instructionId}`, {
      payeePaymentReference: r.instructionId,
      callbackUrl: `${this.config.callbackBase}${r.callbackPath}`,
      payeeAlias: r.payee,
      currency: 'SEK',
      amount: swishAmount(r.amountOre),
      message: swishMessage(r.message),
    });
    if (res.status !== 201) throw toError(res);
    const token = res.headers['paymentrequesttoken'];
    if (typeof token !== 'string') throw new SwishError('NO_TOKEN', 'Swish returned no token');
    return { token };
  }

  async status(id: string): Promise<SwishState> {
    const res = await this.call('GET', `/api/v1/paymentrequests/${id}`);
    if (res.status !== 200) throw toError(res);
    return parseState(res.body, STATUS);
  }

  async refund(r: SwishRefundRequest) {
    const res = await this.call('PUT', `/api/v2/refunds/${r.instructionId}`, {
      originalPaymentReference: r.originalPaymentReference,
      callbackUrl: `${this.config.callbackBase}${r.callbackPath}`,
      payerAlias: r.payer,
      currency: 'SEK',
      amount: swishAmount(r.amountOre),
      message: swishMessage(r.message),
    });
    if (res.status !== 201) throw toError(res);
  }

  async refundStatus(id: string): Promise<SwishState> {
    const res = await this.call('GET', `/api/v1/refunds/${id}`);
    if (res.status !== 200) throw toError(res);
    return parseState(res.body, REFUND_STATUS);
  }

  async cancel(id: string): Promise<SwishState> {
    const res = await this.call(
      'PATCH',
      `/api/v1/paymentrequests/${id}`,
      [{ op: 'replace', path: '/status', value: 'cancelled' }],
      'application/json-patch+json',
    );
    // Too late to cancel (paid or already ended): report what it is now.
    if (res.status !== 200) return this.status(id);
    return { status: 'cancelled' };
  }

  async qrSvg(token: string) {
    const res = await fetch(this.config.qrUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, format: 'svg', size: 300, border: 0 }),
    });
    if (!res.ok) throw new SwishError('QR_FAILED', `Swish QR service answered ${res.status}`);
    return res.text();
  }

  private call(
    method: string,
    path: string,
    body?: unknown,
    contentType = 'application/json',
  ): Promise<HttpResult> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        `${this.config.baseUrl}${path}`,
        {
          method,
          pfx: this.config.pfx,
          passphrase: this.config.passphrase,
          ...(this.config.ca && { ca: this.config.ca }),
          timeout: 10_000,
          headers: payload
            ? { 'content-type': contentType, 'content-length': Buffer.byteLength(payload) }
            : {},
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
          );
        },
      );
      req.on('timeout', () => req.destroy(new SwishError('TIMEOUT', 'Swish did not answer')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}

function parseState(json: string, statuses: Record<string, SwishStatus>): SwishState {
  const body = JSON.parse(json) as {
    status: string;
    errorCode?: string | null;
    datePaid?: string | null;
    paymentReference?: string | null;
  };
  return {
    status: statuses[body.status] ?? 'error',
    ...(body.errorCode && { errorCode: body.errorCode }),
    ...(body.datePaid && { paidAt: new Date(body.datePaid) }),
    ...(body.paymentReference && { paymentReference: body.paymentReference }),
  };
}

function toError(res: HttpResult): SwishError {
  try {
    const errors = JSON.parse(res.body) as { errorCode: string; errorMessage: string }[];
    if (Array.isArray(errors) && errors[0]) {
      return new SwishError(errors[0].errorCode, errors[0].errorMessage);
    }
  } catch {
    // Not JSON: fall through.
  }
  return new SwishError(`HTTP_${res.status}`, `Swish answered ${res.status}`);
}

// ---------------------------------------------------------------------------------------------

const ENDPOINTS = {
  test: {
    baseUrl: 'https://mss.cpc.getswish.net/swish-cpcapi',
    qrUrl: 'https://mpc.getswish.net/qrg-swish/api/v1/commerce',
  },
  production: {
    baseUrl: 'https://cpc.getswish.net/swish-cpcapi',
    qrUrl: 'https://mpc.getswish.net/qrg-swish/api/v1/commerce',
  },
} as const;

/**
 * SWISH_MODE=simulator (default) needs nothing. SWISH_MODE=test (Swish's Merchant Swish
 * Simulator) or production needs SWISH_CERT_P12, SWISH_CERT_PASSPHRASE and SWISH_CALLBACK_URL,
 * and optionally SWISH_CA.
 */
export function swishFromEnv(env: NodeJS.ProcessEnv = process.env): SwishClient {
  const mode = env.SWISH_MODE ?? 'simulator';
  if (mode === 'simulator') return new SimulatedSwish();
  if (mode !== 'test' && mode !== 'production') {
    throw new Error(`SWISH_MODE must be simulator, test or production, not "${mode}"`);
  }
  const missing = ['SWISH_CERT_P12', 'SWISH_CERT_PASSPHRASE', 'SWISH_CALLBACK_URL'].filter(
    (k) => !env[k],
  );
  if (missing.length > 0) throw new Error(`SWISH_MODE=${mode} needs ${missing.join(', ')}`);
  return new HttpSwish({
    ...ENDPOINTS[mode],
    pfx: readFileSync(env.SWISH_CERT_P12!),
    passphrase: env.SWISH_CERT_PASSPHRASE!,
    ...(env.SWISH_CA && { ca: readFileSync(env.SWISH_CA) }),
    callbackBase: env.SWISH_CALLBACK_URL!.replace(/\/$/, ''),
  });
}
