import { useState } from 'react';
import { createXReport, createZReport, type Report } from './api';
import { formatDateTime, formatKr, PAYMENT_LABELS } from './format';
import { useT } from './i18n';

interface Props {
  type: 'x' | 'z';
  onClose: () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** X report (snapshot) or Z report (closes the day). Z asks for confirmation first. */
export function ReportDialog({ type, onClose }: Props) {
  const t = useT();
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
      aria-label={type === 'x' ? t('X report') : t('Z report')}
    >
      <div className="dialog">
        {!report && (
          <>
            <h2>{type === 'x' ? t('X report') : t('Z report – close the day')}</h2>
            <p>
              {type === 'x'
                ? t('Shows sales since the last Z report. Nothing is closed.')
                : t(
                    'Closes the period and stores its totals for good. The next sale goes on the next Z report.',
                  )}
            </p>
            {error && (
              <p className="error" role="alert">
                {t(error)}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={onClose} disabled={busy}>
                {t('Cancel')}
              </button>
              <button type="button" className="primary" onClick={take} disabled={busy}>
                {busy ? t('Creating…') : type === 'x' ? t('Show X report') : t('Take Z report')}
              </button>
            </div>
          </>
        )}

        {report && (
          <>
            <div className="receipt">
              <p className="receipt-seller">
                {report.zNumber
                  ? t('Z REPORT no. {number}', { number: report.zNumber })
                  : t('X REPORT')}
              </p>
              <p>{report.seller.legalName}</p>
              <p>
                {t('Org. no. {number}', {
                  number: report.seller.orgNumber.replace(/^(\d{6})/, '$1-'),
                })}
              </p>
              <p>{t('Register {name}', { name: report.register.designation })}</p>
              <p className="small">
                {formatDateTime(report.periodFrom)} – {formatDateTime(report.periodTo)}
              </p>
              <hr />
              <Row
                label={t('Sales ({count})', { count: report.counts.sale })}
                ore={report.salesTotalOre}
              />
              <Row
                label={t('Returns ({count})', { count: report.counts.return })}
                ore={report.returnsTotalOre}
              />
              <Row label={t('Net sales')} ore={report.netTotalOre} bold />
              <hr />
              {report.totalsByVat.length === 0 && <p className="small muted">{t('No VAT')}</p>}
              {report.totalsByVat.map((v) => (
                <Row
                  key={v.vatRate}
                  label={t('VAT {rate}% on {net}', { rate: v.vatRate, net: formatKr(v.netOre) })}
                  ore={v.vatOre}
                  small
                />
              ))}
              <hr />
              {Object.entries(report.totalsByPayment).map(([m, amount]) => (
                <Row
                  key={m}
                  label={t(PAYMENT_LABELS[m as keyof typeof PAYMENT_LABELS])}
                  ore={amount}
                />
              ))}
              {report.cashRoundingOre !== 0 && (
                <Row label={t('Cash rounding')} ore={report.cashRoundingOre} small />
              )}
              <hr />
              <Row
                label={t('Copies ({count})', { count: report.counts.copy })}
                ore={report.copyTotalOre}
                small
              />
              <Row
                label={t('Training ({count})', { count: report.counts.training })}
                ore={report.trainingTotalOre}
                small
              />
              <Row
                label={t('Proforma ({count})', { count: report.counts.proforma })}
                ore={report.proformaTotalOre}
                small
              />
              <p className="row small">
                <span>{t('Drawer openings')}</span>
                <span>{report.drawerOpenCount}</span>
              </p>
              <hr />
              <Row label={t('Grand total sales')} ore={report.grandTotals.salesOre} small />
              <Row label={t('Grand total returns')} ore={report.grandTotals.returnsOre} small />
              <Row label={t('Grand total net')} ore={report.grandTotals.netOre} bold />
            </div>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => window.print()}>
                {t('Print')}
              </button>
              <button type="button" className="primary" onClick={onClose} autoFocus>
                {t('Done')}
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
