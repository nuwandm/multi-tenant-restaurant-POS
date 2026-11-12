import { ore, roundToKrona } from '@pos/domain';
import { useState } from 'react';
import { formatKr } from './format';

interface Props {
  totalOre: number;
  busy: boolean;
  onPay: (amountOre: number, changeOre: number) => void;
  onCancel: () => void;
}

const NOTES = [10000, 20000, 50000, 100000];

/** Cash payment: the amount due is rounded to whole kronor; the cashier enters what was handed over. */
export function CashDialog({ totalOre, busy, onPay, onCancel }: Props) {
  const dueOre = roundToKrona(ore(totalOre));
  const [tenderedKr, setTenderedKr] = useState('');

  const tenderedOre =
    tenderedKr === '' ? dueOre : Math.round(Number(tenderedKr.replace(',', '.')) * 100);
  const valid = Number.isFinite(tenderedOre) && tenderedOre >= dueOre;
  const changeOre = valid ? tenderedOre - dueOre : 0;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Kontant betalning">
      <div className="dialog">
        <h2>Kontant</h2>
        <dl className="cash-summary">
          <dt>Att betala</dt>
          <dd>{formatKr(totalOre)}</dd>
          {dueOre !== totalOre && (
            <>
              <dt>Avrundat</dt>
              <dd>{formatKr(dueOre)}</dd>
            </>
          )}
        </dl>

        <label className="field">
          Mottaget (kr)
          <input
            inputMode="decimal"
            autoFocus
            placeholder={String(dueOre / 100)}
            value={tenderedKr}
            onChange={(e) => setTenderedKr(e.target.value)}
          />
        </label>
        <div className="quick-amounts">
          <button type="button" onClick={() => setTenderedKr('')}>
            Jämnt
          </button>
          {NOTES.filter((n) => n >= dueOre).map((n) => (
            <button key={n} type="button" onClick={() => setTenderedKr(String(n / 100))}>
              {formatKr(n)}
            </button>
          ))}
        </div>

        <p className={`change ${valid ? '' : 'invalid'}`}>
          {valid ? `Växel: ${formatKr(changeOre)}` : 'Mottaget belopp räcker inte'}
        </p>

        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            Avbryt
          </button>
          <button
            type="button"
            className="primary"
            disabled={!valid || busy}
            onClick={() => onPay(dueOre, changeOre)}
          >
            {busy ? 'Signerar…' : 'Slutför'}
          </button>
        </div>
      </div>
    </div>
  );
}
