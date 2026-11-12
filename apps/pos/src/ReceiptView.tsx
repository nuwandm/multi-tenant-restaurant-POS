import type { Receipt } from './api';
import { formatDateTime, formatKr, PAYMENT_LABELS } from './format';

interface Props {
  receipt: Receipt;
  restaurantName: string;
  changeOre: number;
  onNewSale: () => void;
}

/** On-screen receipt. Field layout to be checked against SKVFS 2014:9 before printing for real. */
export function ReceiptView({ receipt, restaurantName, changeOre, onNewSale }: Props) {
  const training = receipt.kind === 'training';

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Kvitto">
      <div className="dialog receipt-dialog">
        <div className="receipt">
          {training && <p className="receipt-banner">TRÄNINGSKVITTO – EJ GILTIGT</p>}
          <p className="receipt-seller">{receipt.seller.legalName}</p>
          <p>{restaurantName}</p>
          <p>Org.nr {receipt.seller.orgNumber.replace(/^(\d{6})/, '$1-')}</p>
          <hr />
          <p className="row">
            <span>Kassa {receipt.register.designation}</span>
            <span>Kvitto nr {receipt.receiptNumber}</span>
          </p>
          <p>{formatDateTime(receipt.createdAt)}</p>
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
            <span>Totalt</span>
            <span>{formatKr(receipt.totalOre)}</span>
          </p>
          {receipt.vatTotals.map((v) => (
            <p key={v.vatRate} className="row small">
              <span>
                Moms {v.vatRate}% (netto {formatKr(v.netOre)})
              </span>
              <span>{formatKr(v.vatOre)}</span>
            </p>
          ))}
          {receipt.cashRoundingOre !== 0 && (
            <p className="row small">
              <span>Öresavrundning</span>
              <span>{formatKr(receipt.cashRoundingOre)}</span>
            </p>
          )}
          <hr />
          {receipt.payments.map((p, i) => (
            <p key={i} className="row">
              <span>{PAYMENT_LABELS[p.method]}</span>
              <span>{formatKr(p.amountOre)}</span>
            </p>
          ))}
          {changeOre > 0 && (
            <p className="row">
              <span>Växel</span>
              <span>{formatKr(changeOre)}</span>
            </p>
          )}
          <hr />
          <p className="small">Kontrollkod</p>
          <p className="control-code">{receipt.controlCode}</p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={() => window.print()}>
            Skriv ut
          </button>
          <button type="button" className="primary" onClick={onNewSale} autoFocus>
            Ny försäljning
          </button>
        </div>
      </div>
    </div>
  );
}
