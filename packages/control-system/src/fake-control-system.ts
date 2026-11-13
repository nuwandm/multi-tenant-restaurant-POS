import {
  ControlSystemUnavailableError,
  type ControlSystem,
  type ControlSystemStatus,
  type RegisterRegisterInput,
  type RegisterRegisterResult,
  type SignReceiptInput,
  type SignedReceipt,
} from './control-system';

/** Lengths of real codes and serials, so exports from test data validate (SKVFS 2021:16). */
const CONTROL_CODE_LENGTH = 59;
const SERIAL_LENGTH = 17;

/** In-memory control system for tests. Deterministic codes, idempotent signing, switchable outage. */
export class FakeControlSystem implements ControlSystem {
  private online = true;
  private registerCount = 0;
  private readonly signatures = new Map<string, SignedReceipt>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  setOnline(online: boolean): void {
    this.online = online;
  }

  get signedCount(): number {
    return this.signatures.size;
  }

  async registerRegister(input: RegisterRegisterInput): Promise<RegisterRegisterResult> {
    this.assertOnline();
    this.registerCount += 1;
    return {
      controlSystemRef: `FAKE-${input.designation}-${this.registerCount}`,
      serialNumber: `FAKE${String(this.registerCount).padStart(SERIAL_LENGTH - 4, '0')}`,
    };
  }

  async signReceipt(input: SignReceiptInput): Promise<SignedReceipt> {
    this.assertOnline();
    const existing = this.signatures.get(input.idempotencyKey);
    if (existing) return existing;

    const signed: SignedReceipt = {
      // Readable, unique per receipt, padded to the real length; the dash keeps 1 and 10 apart.
      controlCode: `FAKE-${input.controlSystemRef}-${input.kind}-${input.receiptNumber}-`
        .padEnd(CONTROL_CODE_LENGTH, 'X')
        .slice(0, CONTROL_CODE_LENGTH),
      signedAt: this.now(),
    };
    this.signatures.set(input.idempotencyKey, signed);
    return signed;
  }

  async getStatus(): Promise<ControlSystemStatus> {
    return { online: this.online };
  }

  private assertOnline(): void {
    if (!this.online) {
      throw new ControlSystemUnavailableError('Fake control system is offline');
    }
  }
}
