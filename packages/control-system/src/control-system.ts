/**
 * Port to a certified control unit or cloud control system (kontrollsystem).
 * Phase 4 adds the real provider adapter; the shape may grow once its sandbox docs are in docs/compliance.
 */
export interface ControlSystem {
  registerRegister(input: RegisterRegisterInput): Promise<RegisterRegisterResult>;
  signReceipt(input: SignReceiptInput): Promise<SignedReceipt>;
  getStatus(): Promise<ControlSystemStatus>;
}

export interface RegisterRegisterInput {
  orgNumber: string;
  designation: string;
}

export interface RegisterRegisterResult {
  controlSystemRef: string;
}

export type ReceiptKind = 'sale' | 'return' | 'copy' | 'training' | 'proforma';

export interface SignReceiptInput {
  /** Same key on a retry must return the same signature. */
  idempotencyKey: string;
  controlSystemRef: string;
  orgNumber: string;
  receiptNumber: number;
  kind: ReceiptKind;
  createdAt: Date;
  totalInclVatOre: number;
  vatTotalsOre: Partial<Record<25 | 12 | 6 | 0, number>>;
}

export interface SignedReceipt {
  controlCode: string;
  signedAt: Date;
}

export interface ControlSystemStatus {
  online: boolean;
}

export class ControlSystemUnavailableError extends Error {
  override readonly name = 'ControlSystemUnavailableError';
}
