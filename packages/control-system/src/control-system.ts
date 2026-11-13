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
  /**
   * The control system's manufacturing number (tillverkningsnummer, 8 kap. 37 § SKVFS 2020:9),
   * 17 characters. Goes into the journal export and onto receipts.
   */
  serialNumber: string;
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
  /** 59 characters, as the journal export (SKVFS 2021:16) requires. */
  controlCode: string;
  signedAt: Date;
}

export interface ControlSystemStatus {
  online: boolean;
}

export class ControlSystemUnavailableError extends Error {
  override readonly name = 'ControlSystemUnavailableError';
}
