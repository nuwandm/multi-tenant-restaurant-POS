import { ore, roundToKrona } from '@pos/domain';
import { useState } from 'react';
import { formatKr } from './format';
import { useT } from './i18n';

interface Props {
  totalOre: number;
  busy: boolean;
  onPay: (amountOre: number, changeOre: number) => void;
  onCancel: () => void;
}

const NOTES = [10000, 20000, 50000, 100000];

/** Cash payment: the amount due is rounded to whole kronor; the cashier enters what was handed over. */
export function CashDialog({ totalOre, busy, onPay, onCancel }: Props) {
  const t = useT();
  const dueOre = roundToKrona(ore(totalOre));
  const [tenderedKr, setTenderedKr] = useState('');

  const tenderedOre =
    tenderedKr === '' ? dueOre : Math.round(Number(tenderedKr.replace(',', '.')) * 100);
  const valid = Number.isFinite(tenderedOre) && tenderedOre >= dueOre;
  const changeOre = valid ? tenderedOre - dueOre : 0;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('Cash payment')}>
      <div className="dialog">
        <h2>{t('Cash')}</h2>
        <dl className="cash-summary">
          <dt>{t('To pay')}</dt>
          <dd>{formatKr(totalOre)}</dd>
          {dueOre !== totalOre && (
            <>
              <dt>{t('Rounded')}</dt>
              <dd>{formatKr(dueOre)}</dd>
            </>
          )}
        </dl>

        <label className="field">
          {t('Received (kr)')}
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
            {t('Exact')}
          </button>
          {NOTES.filter((n) => n >= dueOre).map((n) => (
            <button key={n} type="button" onClick={() => setTenderedKr(String(n / 100))}>
              {formatKr(n)}
            </button>
          ))}
        </div>

        <p className={`change ${valid ? '' : 'invalid'}`}>
          {valid
            ? t('Change: {amount}', { amount: formatKr(changeOre) })
            : t('The amount received is not enough')}
        </p>

        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!valid || busy}
            onClick={() => onPay(dueOre, changeOre)}
          >
            {busy ? t('Signing…') : t('Complete')}
          </button>
        </div>
      </div>
    </div>
  );
}
