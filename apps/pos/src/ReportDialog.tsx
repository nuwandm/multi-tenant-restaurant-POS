import { useState } from 'react';
import { createXReport, createZReport, type Report } from './api';
import { formatDateTime, formatKr, PAYMENT_LABELS } from './format';

interface Props {
  type: 'x' | 'z';
  onClose: () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** X report (snapshot) or Z report (closes the day). Z asks for confirmation first. */
export function ReportDialog({ type, onClose }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function take() {
    setBusy(true);
    setError(null);
    try {
      setReport(await (type === 'x' ? createXReport() : createZReport()));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${type.toUpperCase()}-rapport`}
    >
      <div className="dialog">
        {!report && (
          <>
            <h2>{type === 'x' ? 'X-rapport' : 'Z-rapport – stäng dagen'}</h2>
            <p>
              {type === 'x'
                ? 'Visar försäljningen hittills sedan senaste Z-rapport. Ingenting stängs.'
                : 'Stänger perioden och sparar dagens totaler för gott. Nästa försäljning hamnar på nästa Z-rapport.'}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={busy}>
                Avbryt
              </button>
              <button type="button" className="primary" onClick={take} disabled={busy}>
                {busy ? 'Skapar…' : type === 'x' ? 'Visa X-rapport' : 'Ta Z-rapport'}
              </button>
            </div>
          </>
        )}

        {report && (
          <>
            <div className="receipt">
              <p className="receipt-seller">
                {report.zNumber ? `Z-RAPPORT nr ${report.zNumber}` : 'X-RAPPORT'}
              </p>
              <p>{report.seller.legalName}</p>
              <p>Org.nr {report.seller.orgNumber.replace(/^(\d{6})/, '$1-')}</p>
              <p>Kassa {report.register.designation}</p>
              <p className="small">
                {formatDateTime(report.periodFrom)} – {formatDateTime(report.periodTo)}
              </p>
              <hr />
              <Row label={`Försäljning (${report.counts.sale})`} ore={report.salesTotalOre} />
              <Row label={`Returer (${report.counts.return})`} ore={report.returnsTotalOre} />
              <Row label="Nettoförsäljning" ore={report.netTotalOre} bold />
              <hr />
              {report.totalsByVat.length === 0 && <p className="small muted">Ingen moms</p>}
              {report.totalsByVat.map((v) => (
                <Row
                  key={v.vatRate}
                  label={`Moms ${v.vatRate}% på ${formatKr(v.netOre)}`}
                  ore={v.vatOre}
                  small
                />
              ))}
              <hr />
              {Object.entries(report.totalsByPayment).map(([m, amount]) => (
                <Row
                  key={m}
                  label={PAYMENT_LABELS[m as keyof typeof PAYMENT_LABELS]}
                  ore={amount}
                />
              ))}
              {report.cashRoundingOre !== 0 && (
                <Row label="Öresavrundning" ore={report.cashRoundingOre} small />
              )}
              <hr />
              <Row label={`Kopior (${report.counts.copy})`} ore={report.copyTotalOre} small />
              <Row
                label={`Träning (${report.counts.training})`}
                ore={report.trainingTotalOre}
                small
              />
              <Row
                label={`Proforma (${report.counts.proforma})`}
                ore={report.proformaTotalOre}
                small
              />
              <p className="row small">
                <span>Lådöppningar</span>
                <span>{report.drawerOpenCount}</span>
              </p>
              <hr />
              <Row label="Grand total försäljning" ore={report.grandTotals.salesOre} small />
              <Row label="Grand total returer" ore={report.grandTotals.returnsOre} small />
              <Row label="Grand total netto" ore={report.grandTotals.netOre} bold />
            </div>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => window.print()}>
                Skriv ut
              </button>
              <button type="button" className="primary" onClick={onClose} autoFocus>
                Klar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  ore,
  bold,
  small,
}: {
  label: string;
  ore: number;
  bold?: boolean;
  small?: boolean;
}) {
  return (
    <p className={`row ${bold ? 'total' : ''} ${small ? 'small' : ''}`}>
      <span>{label}</span>
      <span>{formatKr(ore)}</span>
    </p>
  );
}
