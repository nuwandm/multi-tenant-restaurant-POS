import { divRound, ore, roundToKrona, type PaymentMethod } from '@pos/domain';
import { useEffect, useState } from 'react';
import {
  createCopy,
  createReturn,
  listReceipts,
  newAttemptKey,
  type ListedReceipt,
  type Receipt,
} from './api';
import { formatDateTime, formatKr, PAYMENT_LABELS } from './format';
import { useT } from './i18n';

interface Props {
  onDone: (receipt: Receipt) => void;
  onClose: () => void;
  /** Returns need a manager or owner; the API enforces it too. */
  canReturn: boolean;
}

export const KIND_LABELS: Record<Receipt['kind'], string> = {
  sale: 'Sale',
  return: 'Return',
  copy: 'Copy',
  training: 'Training',
  proforma: 'Proforma',
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Recent receipts on this register: print a copy, or return all or part of a sale. */
export function ReceiptsDialog({ onDone, onClose, canReturn }: Props) {
  const t = useT();
  const [receipts, setReceipts] = useState<ListedReceipt[] | null>(null);
  const [selected, setSelected] = useState<ListedReceipt | null>(null);
  const [returning, setReturning] = useState(false);
  // One key per opened receipt: retrying a copy or return after a lost connection is safe.
  const [attemptKey, setAttemptKey] = useState(newAttemptKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listReceipts()
      .then(setReceipts)
      .catch((err: unknown) => setError(message(err)));
  }, []);

  async function run(action: () => Promise<Receipt>) {
    setBusy(true);
    setError(null);
    try {
      onDone(await action());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('Receipts')}>
      <div className="dialog wide">
        <div className="dialog-header">
          <h2>
            {selected
              ? t('{kind} no. {number}', {
                  kind: t(KIND_LABELS[selected.kind]),
                  number: selected.receiptNumber,
                })
              : t('Receipts')}
          </h2>
          <button
            type="button"
            className="link"
            onClick={selected ? () => setSelected(null) : onClose}
          >
            {selected ? t('← Back') : t('Close')}
          </button>
        </div>

        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}

        {!selected && !receipts && !error && <p className="muted">{t('Loading…')}</p>}
        {!selected && receipts?.length === 0 && <p className="muted">{t('No receipts yet.')}</p>}
        {!selected && receipts && receipts.length > 0 && (
          <ul className="receipt-list">
            {receipts.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(r);
                    setAttemptKey(newAttemptKey());
                    setReturning(false);
                    setError(null);
                  }}
                >
                  <span className={`kind kind-${r.kind}`}>{t(KIND_LABELS[r.kind])}</span>
                  <span>{t('no. {number}', { number: r.receiptNumber })}</span>
                  <span className="muted">{formatDateTime(r.createdAt)}</span>
                  <span className="amount">{formatKr(r.totalOre)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && !returning && (
          <>
            <ul className="detail-lines">
              {selected.lines.map((l) => (
                <li key={l.lineNo} className="row">
                  <span>
                    {l.quantity} × {l.name}
                    {(selected.returnedQuantities[l.lineNo] ?? 0) > 0 && (
                      <span className="muted">
                        {' '}
                        {t('(returned {count})', { count: selected.returnedQuantities[l.lineNo]! })}
                      </span>
                    )}
                  </span>
                  <span>{formatKr(l.lineTotalOre)}</span>
                </li>
              ))}
            </ul>
            <p className="row grand-total">
              <span>{t('Total')}</span>
              <span>{formatKr(selected.totalOre)}</span>
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy || selected.kind === 'copy'}
                onClick={() => run(() => createCopy(selected.id, attemptKey))}
              >
                {t('Print copy')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || selected.kind !== 'sale' || !canReturn}
                title={canReturn ? undefined : t('Managers and owners only')}
                onClick={() => setReturning(true)}
              >
                {t('Return…')}
              </button>
            </div>
          </>
        )}

        {selected && returning && (
          <ReturnForm
            original={selected}
            busy={busy}
            onSubmit={(lines, method, amountOre) =>
              run(() =>
                createReturn(
                  {
                    originalReceiptId: selected.id,
                    lines,
                    payments: [{ method, amountOre }],
                  },
                  attemptKey,
                ),
              )
            }
          />
        )}
      </div>
    </div>
  );
}

interface ReturnFormProps {
  original: ListedReceipt;
  busy: boolean;
  onSubmit: (
    lines: { lineNo: number; quantity: number }[],
    method: PaymentMethod,
    amountOre: number,
  ) => void;
}

function ReturnForm({ original, busy, onSubmit }: ReturnFormProps) {
  const t = useT();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [method, setMethod] = useState<PaymentMethod>(original.payments[0]?.method ?? 'card');

  // Same cumulative rounding as the API, so the refund shown is the refund stored.
  const refundOre = original.lines.reduce((sum, l) => {
    const q = quantities[l.lineNo] ?? 0;
    const before = original.returnedQuantities[l.lineNo] ?? 0;
    const share = (n: number) => divRound(l.lineTotalOre * n, l.quantity);
    return sum + share(before + q) - share(before);
  }, 0);
  const payOutOre = method === 'cash' ? roundToKrona(ore(refundOre)) : refundOre;
  const lines = Object.entries(quantities)
    .filter(([, q]) => q > 0)
    .map(([lineNo, quantity]) => ({ lineNo: Number(lineNo), quantity }));

  return (
    <>
      <ul className="detail-lines">
        {original.lines.map((l) => {
          const left = l.quantity - (original.returnedQuantities[l.lineNo] ?? 0);
          const q = quantities[l.lineNo] ?? 0;
          const set = (n: number) => setQuantities((qs) => ({ ...qs, [l.lineNo]: n }));
          return (
            <li key={l.lineNo} className="return-line">
              <span>
                {l.name} <span className="muted">{t('({count} left)', { count: left })}</span>
              </span>
              <span className="qty">
                <button
                  type="button"
                  disabled={q === 0}
                  onClick={() => set(q - 1)}
                  aria-label={t('Fewer')}
                >
                  −
                </button>
                <span>{q}</span>
                <button
                  type="button"
                  disabled={q >= left}
                  onClick={() => set(q + 1)}
                  aria-label={t('More')}
                >
                  +
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="muted small">{t('Refund with')}</p>
      <div className="method-choice">
        {(['card', 'swish', 'cash'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={m === method ? 'active' : ''}
            onClick={() => setMethod(m)}
          >
            {t(PAYMENT_LABELS[m])}
          </button>
        ))}
      </div>

      <p className="row grand-total">
        <span>{t('Refund')}</span>
        <span>{formatKr(payOutOre)}</span>
      </p>
      <button
        type="button"
        className="primary full"
        disabled={busy || lines.length === 0}
        onClick={() => onSubmit(lines, method, -payOutOre)}
      >
        {busy ? t('Signing…') : t('Make return')}
      </button>
    </>
  );
}
