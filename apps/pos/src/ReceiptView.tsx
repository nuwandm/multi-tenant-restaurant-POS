import type { Receipt } from './api';
import { formatDateTime, formatKr, PAYMENT_LABELS } from './format';
import { useT } from './i18n';

interface Props {
  receipt: Receipt;
  restaurantName: string;
  changeOre: number;
  onNewSale: () => void;
}

const BANNERS: Partial<Record<Receipt['kind'], string>> = {
  training: 'TRAINING RECEIPT – NOT VALID',
  copy: 'COPY',
  return: 'RETURN RECEIPT',
};

/** On-screen receipt. Field layout to be checked against SKVFS 2014:9 before printing for real. */
export function ReceiptView({ receipt, restaurantName, changeOre, onNewSale }: Props) {
  const t = useT();
  const banner = BANNERS[receipt.kind];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('Receipt')}>
      <div className="dialog receipt-dialog">
        <div className="receipt">
          {banner && <p className="receipt-banner">{t(banner)}</p>}
          <p className="receipt-seller">{receipt.seller.legalName}</p>
          <p>{restaurantName}</p>
          <p>
            {t('Org. no. {number}', {
              number: receipt.seller.orgNumber.replace(/^(\d{6})/, '$1-'),
            })}
          </p>
          <hr />
          <p className="row">
            <span>{t('Register {name}', { name: receipt.register.designation })}</span>
            <span>{t('Receipt no. {number}', { number: receipt.receiptNumber })}</span>
          </p>
          <p>{formatDateTime(receipt.createdAt)}</p>
          {receipt.cashier && <p>{t('Cashier: {name}', { name: receipt.cashier.displayName })}</p>}
          <hr />
          {receipt.lines.map((l) => (
            <p key={l.lineNo} className="row">
              <span>
                {l.quantity} × {l.name}
              </span>
              <span>{formatKr(l.lineTotalOre)}</span>
            </p>
          ))}
          <hr />
          <p className="row total">
            <span>{t('Total')}</span>
            <span>{formatKr(receipt.totalOre)}</span>
          </p>
          {receipt.vatTotals.map((v) => (
            <p key={v.vatRate} className="row small">
              <span>
                {t('VAT {rate}% (net {net})', { rate: v.vatRate, net: formatKr(v.netOre) })}
              </span>
              <span>{formatKr(v.vatOre)}</span>
            </p>
          ))}
          {receipt.cashRoundingOre !== 0 && (
            <p className="row small">
              <span>{t('Cash rounding')}</span>
              <span>{formatKr(receipt.cashRoundingOre)}</span>
            </p>
          )}
          <hr />
          {receipt.payments.map((p, i) => (
            <p key={i} className="row">
              <span>{t(PAYMENT_LABELS[p.method])}</span>
              <span>{formatKr(p.amountOre)}</span>
            </p>
          ))}
          {changeOre > 0 && (
            <p className="row">
              <span>{t('Change')}</span>
              <span>{formatKr(changeOre)}</span>
            </p>
          )}
          <hr />
          <p className="small">{t('Control code')}</p>
          <p className="control-code">{receipt.controlCode}</p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={() => window.print()}>
            {t('Print')}
          </button>
          <button type="button" className="primary" onClick={onNewSale} autoFocus>
            {t('New sale')}
          </button>
        </div>
      </div>
    </div>
  );
}
