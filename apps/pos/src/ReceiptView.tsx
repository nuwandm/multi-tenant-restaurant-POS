import { Button, Group, Modal, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconCheck, IconPrinter } from '@tabler/icons-react';
import type { Receipt } from './api';
import { formatDateTime, formatKr, PAYMENT_LABELS } from './format';
import { useT } from './i18n';
import { ReceiptPaper } from './ReceiptPaper';

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

/** The receipt after a sale, return or copy. Field layout to be checked against SKVFS 2014:9. */
export function ReceiptView({ receipt, restaurantName, changeOre, onNewSale }: Props) {
  const t = useT();
  const banner = BANNERS[receipt.kind];
  const org = receipt.seller.orgNumber.replace(/^(\d{6})/, '$1-');

  return (
    <Modal opened onClose={onNewSale} withCloseButton={false} size={420} padding="lg">
      <Stack gap="lg">
        <Group gap="sm">
          <ThemeIcon radius="xl" size="lg" color={receipt.kind === 'training' ? 'orange' : 'brand'}>
            <IconCheck size={20} />
          </ThemeIcon>
          <div>
            <Text fw={650}>
              {receipt.kind === 'return'
                ? t('Return completed')
                : receipt.kind === 'copy'
                  ? t('Copy printed')
                  : t('Payment completed')}
            </Text>
            {changeOre > 0 && (
              <Text fz="sm" c="dimmed">
                {t('Give back {amount} in change', { amount: formatKr(changeOre) })}
              </Text>
            )}
          </div>
        </Group>

        <ReceiptPaper>
          {banner && <div className="stamp">{t(banner)}</div>}
          <div className="center">
            <strong>{receipt.seller.legalName}</strong>
            <div>{restaurantName}</div>
            <div>{t('Org. no. {number}', { number: org })}</div>
          </div>
          <hr />
          <div className="row">
            <span>{t('Register {name}', { name: receipt.register.designation })}</span>
            <span>{t('Receipt no. {number}', { number: receipt.receiptNumber })}</span>
          </div>
          <div>{formatDateTime(receipt.createdAt)}</div>
          {receipt.cashier && (
            <div>{t('Cashier: {name}', { name: receipt.cashier.displayName })}</div>
          )}
          <hr />
          {receipt.lines.map((l) => (
            <div key={l.lineNo} className="row">
              <span>
                {l.quantity} × {l.name}
              </span>
              <span>{formatKr(l.lineTotalOre)}</span>
            </div>
          ))}
          <hr />
          <div className="row" style={{ fontWeight: 700, fontSize: 15 }}>
            <span>{t('Total')}</span>
            <span>{formatKr(receipt.totalOre)}</span>
          </div>
          {receipt.vatTotals.map((v) => (
            <div key={v.vatRate} className="row">
              <span>
                {t('VAT {rate}% (net {net})', { rate: v.vatRate, net: formatKr(v.netOre) })}
              </span>
              <span>{formatKr(v.vatOre)}</span>
            </div>
          ))}
          {receipt.cashRoundingOre !== 0 && (
            <div className="row">
              <span>{t('Cash rounding')}</span>
              <span>{formatKr(receipt.cashRoundingOre)}</span>
            </div>
          )}
          <hr />
          {receipt.payments.map((p, i) => (
            <div key={i} className="row">
              <span>{t(PAYMENT_LABELS[p.method])}</span>
              <span>{formatKr(p.amountOre)}</span>
            </div>
          ))}
          {changeOre > 0 && (
            <div className="row">
              <span>{t('Change')}</span>
              <span>{formatKr(changeOre)}</span>
            </div>
          )}
          <hr />
          <div className="center">
            <div>{t('Control code')}</div>
            <div style={{ wordBreak: 'break-all', fontWeight: 700 }}>{receipt.controlCode}</div>
          </div>
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
          <Button size="md" onClick={onNewSale} data-autofocus>
            {t('New sale')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
