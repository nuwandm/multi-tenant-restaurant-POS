import { Alert, Button, Group, Modal, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconFileAnalytics, IconPrinter } from '@tabler/icons-react';
import { useState } from 'react';
import { createXReport, createZReport, type Report } from './api';
import { formatDateTime, formatKr, PAYMENT_LABELS } from './format';
import { useT } from './i18n';
import { ReceiptPaper } from './ReceiptPaper';

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
    <Modal
      opened
      onClose={onClose}
      size={report ? 420 : 'md'}
      title={
        <Group gap="sm">
          <ThemeIcon
            variant="light"
            size="lg"
            radius="md"
            color={type === 'z' ? 'orange' : 'brand'}
          >
            <IconFileAnalytics size={20} stroke={1.6} />
          </ThemeIcon>
          <Text fw={650} fz="lg">
            {type === 'x' ? t('X report') : t('Z report – close the day')}
          </Text>
        </Group>
      }
    >
      {!report && (
        <Stack gap="md">
          <Text c="dimmed">
            {type === 'x'
              ? t('Shows sales since the last Z report. Nothing is closed.')
              : t(
                  'Closes the period and stores its totals for good. The next sale goes on the next Z report.',
                )}
          </Text>
          {type === 'z' && (
            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />}>
              {t('A Z report cannot be undone.')}
            </Alert>
          )}
          {error && (
            <Alert color="red" variant="light">
              {t(error)}
            </Alert>
          )}
          <Group grow>
            <Button variant="default" size="md" onClick={onClose} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button
              size="md"
              color={type === 'z' ? 'orange' : 'brand'}
              loading={busy}
              onClick={take}
            >
              {type === 'x' ? t('Show X report') : t('Take Z report')}
            </Button>
          </Group>
        </Stack>
      )}

      {report && (
        <Stack gap="lg">
          <ReceiptPaper>
            <div className="center">
              <strong style={{ fontSize: 15 }}>
                {report.zNumber
                  ? t('Z REPORT no. {number}', { number: report.zNumber })
                  : t('X REPORT')}
              </strong>
              <div>{report.seller.legalName}</div>
              <div>
                {t('Org. no. {number}', {
                  number: report.seller.orgNumber.replace(/^(\d{6})/, '$1-'),
                })}
              </div>
              <div>{t('Register {name}', { name: report.register.designation })}</div>
              <div>
                {formatDateTime(report.periodFrom)} – {formatDateTime(report.periodTo)}
              </div>
            </div>
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
            {report.totalsByVat.length === 0 && <div>{t('No VAT')}</div>}
            {report.totalsByVat.map((v) => (
              <Row
                key={v.vatRate}
                label={t('VAT {rate}% on {net}', { rate: v.vatRate, net: formatKr(v.netOre) })}
                ore={v.vatOre}
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
              <Row label={t('Cash rounding')} ore={report.cashRoundingOre} />
            )}
            <hr />
            <Row
              label={t('Copies ({count})', { count: report.counts.copy })}
              ore={report.copyTotalOre}
            />
            <Row
              label={t('Training ({count})', { count: report.counts.training })}
              ore={report.trainingTotalOre}
            />
            <Row
              label={t('Proforma ({count})', { count: report.counts.proforma })}
              ore={report.proformaTotalOre}
            />
            <div className="row">
              <span>{t('Drawer openings')}</span>
              <span>{report.drawerOpenCount}</span>
            </div>
            <hr />
            <Row label={t('Grand total sales')} ore={report.grandTotals.salesOre} />
            <Row label={t('Grand total returns')} ore={report.grandTotals.returnsOre} />
            <Row label={t('Grand total net')} ore={report.grandTotals.netOre} bold />
          </ReceiptPaper>
          <Group grow>
            <Button
              variant="default"
              size="md"
              leftSection={<IconPrinter size={18} />}
              onClick={() => window.print()}
            >
              {t('Print')}
            </Button>
            <Button size="md" onClick={onClose} data-autofocus>
              {t('Done')}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function Row({ label, ore, bold }: { label: string; ore: number; bold?: boolean }) {
  return (
    <div className="row" style={bold ? { fontWeight: 700 } : undefined}>
      <span>{label}</span>
      <span>{formatKr(ore)}</span>
    </div>
  );
}
