import { addOre, ore, type Ore } from './money';
import { divRound, roundToKrona } from './rounding';
import { vatTotals, type VatRate, type VatTotal } from './vat';

export type ReceiptKind = 'sale' | 'return' | 'copy' | 'training' | 'proforma';
export type PaymentMethod = 'cash' | 'card' | 'swish' | 'gift_card';

export class ReceiptError extends Error {
  override readonly name = 'ReceiptError';
}

export interface LineInput {
  articleId?: string;
  name: string;
  /** Positive whole number. Returns are built with buildReturn, not with negative quantities. */
  quantity: number;
  /** Unit price including VAT. */
  unitPriceOre: Ore;
  vatRate: VatRate;
  /** Discount on the whole line, including VAT. */
  discountOre?: Ore;
}

export interface PaymentInput {
  method: PaymentMethod;
  /** Amount applied to this receipt (not cash tendered). Negative on returns. */
  amountOre: Ore;
}

export interface ReceiptLine {
  lineNo: number;
  articleId?: string;
  name: string;
  /** Negative on returns. */
  quantity: number;
  unitPriceOre: Ore;
  vatRate: VatRate;
  /** Always ≥ 0; the sign of the line follows the quantity. */
  discountOre: Ore;
  lineTotalOre: Ore;
  /** On a return: the line it returns from the original receipt. */
  originalLineNo?: number;
}

export interface BuiltReceipt {
  kind: ReceiptKind;
  lines: ReceiptLine[];
  vatTotals: VatTotal[];
  /** Exact total including VAT, before cash rounding. */
  totalOre: Ore;
  payments: PaymentInput[];
  /** Cash rounding (öresavrundning) applied to the cash part; payments sum to total + this. */
  cashRoundingOre: Ore;
}

export interface ReceiptInput {
  kind: 'sale' | 'training' | 'proforma';
  lines: LineInput[];
  payments: PaymentInput[];
}

/** Builds a sale, training or proforma receipt. Returns and copies have their own builders. */
export function buildReceipt(input: ReceiptInput): BuiltReceipt {
  if (input.lines.length === 0) throw new ReceiptError('A receipt needs at least one line');

  const lines = input.lines.map((line, i): ReceiptLine => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new ReceiptError(`Line ${i + 1}: quantity must be a positive whole number`);
    }
    if (line.unitPriceOre < 0) throw new ReceiptError(`Line ${i + 1}: price cannot be negative`);
    const discount = line.discountOre ?? ore(0);
    const gross = line.quantity * line.unitPriceOre;
    if (discount < 0 || discount > gross) {
      throw new ReceiptError(`Line ${i + 1}: discount must be between 0 and the line amount`);
    }
    return {
      lineNo: i + 1,
      ...(line.articleId !== undefined && { articleId: line.articleId }),
      name: line.name,
      quantity: line.quantity,
      unitPriceOre: line.unitPriceOre,
      vatRate: line.vatRate,
      discountOre: discount,
      lineTotalOre: ore(gross - discount),
    };
  });

  if (input.kind === 'proforma' && input.payments.length > 0) {
    throw new ReceiptError('A proforma receipt cannot take payments');
  }
  return finish(input.kind, lines, input.payments);
}

export interface ReturnInput {
  lines: { lineNo: number; quantity: number }[];
  /** Quantities already returned per original line number, from earlier returns. */
  alreadyReturned?: Record<number, number>;
  payments: PaymentInput[];
}

/** Builds a return of all or part of a sale. Discounted lines are refunded in proportion. */
export function buildReturn(original: BuiltReceipt, input: ReturnInput): BuiltReceipt {
  if (original.kind !== 'sale') throw new ReceiptError('Only a sale can be returned');
  if (input.lines.length === 0) throw new ReceiptError('A return needs at least one line');

  const lines = input.lines.map(({ lineNo, quantity }, i): ReceiptLine => {
    const source = original.lines.find((l) => l.lineNo === lineNo);
    if (!source) throw new ReceiptError(`Line ${lineNo} is not on the original receipt`);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new ReceiptError(`Line ${lineNo}: return quantity must be a positive whole number`);
    }
    const returnedBefore = input.alreadyReturned?.[lineNo] ?? 0;
    if (returnedBefore + quantity > source.quantity) {
      throw new ReceiptError(
        `Line ${lineNo}: cannot return more than was sold (${source.quantity}, already returned ${returnedBefore})`,
      );
    }
    // Refund the difference of cumulative shares, so returning a line piece by piece adds up
    // to exactly what was paid for it, never an öre more.
    const share = (returned: number) => divRound(source.lineTotalOre * returned, source.quantity);
    const refund = share(returnedBefore + quantity) - share(returnedBefore);
    return {
      lineNo: i + 1,
      ...(source.articleId !== undefined && { articleId: source.articleId }),
      name: source.name,
      quantity: -quantity,
      unitPriceOre: source.unitPriceOre,
      vatRate: source.vatRate,
      discountOre: ore(quantity * source.unitPriceOre - refund),
      lineTotalOre: ore(-refund),
      originalLineNo: lineNo,
    };
  });

  return finish('return', lines, input.payments);
}

/** A copy repeats the original's content under its own kind and number series. */
export function buildCopy(original: BuiltReceipt): BuiltReceipt {
  if (original.kind === 'copy') throw new ReceiptError('Copy the original receipt, not a copy');
  return { ...original, kind: 'copy' };
}

function finish(kind: ReceiptKind, lines: ReceiptLine[], payments: PaymentInput[]): BuiltReceipt {
  const totalOre = addOre(...lines.map((l) => l.lineTotalOre));
  const cashRoundingOre = checkPayments(kind, totalOre, payments);
  return {
    kind,
    lines,
    vatTotals: vatTotals(lines.map((l) => ({ vatRate: l.vatRate, amountOre: l.lineTotalOre }))),
    totalOre,
    payments,
    cashRoundingOre,
  };
}

/** Payments must cover the total exactly; only the cash part may be rounded to whole kronor. */
function checkPayments(kind: ReceiptKind, total: Ore, payments: PaymentInput[]): Ore {
  if (kind === 'proforma') return ore(0);

  const cash = payments.filter((p) => p.method === 'cash');
  const nonCashSum = addOre(...payments.filter((p) => p.method !== 'cash').map((p) => p.amountOre));
  const cashSum = addOre(...cash.map((p) => p.amountOre));

  const cashDue = ore(total - nonCashSum);
  const expectedCash = cash.length > 0 ? roundToKrona(cashDue) : cashDue;
  if (cash.length === 0 ? nonCashSum !== total : cashSum !== expectedCash) {
    throw new ReceiptError(
      `Payments (${nonCashSum + cashSum} öre) do not match the total (${total} öre)`,
    );
  }
  return ore(cash.length > 0 ? expectedCash - cashDue : 0);
}
