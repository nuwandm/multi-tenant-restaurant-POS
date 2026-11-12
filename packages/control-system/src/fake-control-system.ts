import {
  ControlSystemUnavailableError,
  type ControlSystem,
  type ControlSystemStatus,
  type RegisterRegisterInput,
  type RegisterRegisterResult,
  type SignReceiptInput,
  type SignedReceipt,
} from './control-system';

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
    return { controlSystemRef: `FAKE-${input.designation}-${this.registerCount}` };
  }

  async signReceipt(input: SignReceiptInput): Promise<SignedReceipt> {
    this.assertOnline();
    const existing = this.signatures.get(input.idempotencyKey);
    if (existing) return existing;

    const signed: SignedReceipt = {
      controlCode: `FAKE-${input.controlSystemRef}-${input.kind}-${input.receiptNumber}`,
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
