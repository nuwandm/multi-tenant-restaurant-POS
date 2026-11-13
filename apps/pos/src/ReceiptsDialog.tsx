import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconCopy,
  IconDeviceMobile,
  IconLock,
  IconMinus,
  IconPlus,
  IconReceiptRefund,
} from '@tabler/icons-react';
import { divRound, ore, roundToKrona, type PaymentMethod } from '@pos/domain';
import { useEffect, useState } from 'react';
import {
  createCopy,
  createReturn,
  refundThroughSwish,
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

const KIND_COLORS: Record<Receipt['kind'], string> = {
  sale: 'brand',
  return: 'red',
  copy: 'gray',
  training: 'orange',
  proforma: 'gray',
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

  const title = selected ? (
    <Group gap="xs">
      <ActionIcon
        variant="subtle"
        color="gray"
        onClick={() => (returning ? setReturning(false) : setSelected(null))}
        aria-label={t('← Back')}
      >
        <IconArrowLeft size={18} />
      </ActionIcon>
      <Text fw={650} fz="lg">
        {t('{kind} no. {number}', {
          kind: t(KIND_LABELS[selected.kind]),
          number: selected.receiptNumber,
        })}
      </Text>
    </Group>
  ) : (
    <Text fw={650} fz="lg">
      {t('Receipts')}
    </Text>
  );

  return (
    <Modal opened onClose={onClose} size="lg" title={title}>
      <Stack gap="md">
        {error && (
          <Alert color="red" variant="light">
            {t(error)}
          </Alert>
        )}

        {!selected && !receipts && !error && (
          <Center h={200}>
            <Loader type="dots" />
          </Center>
        )}
        {!selected && receipts?.length === 0 && (
          <Text c="dimmed" ta="center" py="xl">
            {t('No receipts yet.')}
          </Text>
        )}
        {!selected && receipts && receipts.length > 0 && (
          <ScrollArea.Autosize mah="60vh">
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Tbody>
                {receipts.map((r) => (
                  <Table.Tr
                    key={r.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setSelected(r);
                      setAttemptKey(newAttemptKey());
                      setReturning(false);
                      setError(null);
                    }}
                  >
                    <Table.Td w={120}>
                      <Badge variant="light" color={KIND_COLORS[r.kind]} radius="sm">
                        {t(KIND_LABELS[r.kind])}
                      </Badge>
                    </Table.Td>
                    <Table.Td fw={600} className="tabular">
                      {t('no. {number}', { number: r.receiptNumber })}
                    </Table.Td>
                    <Table.Td c="dimmed" fz="sm">
                      {formatDateTime(r.createdAt)}
                      {r.cashier && ` · ${r.cashier.displayName}`}
                    </Table.Td>
                    <Table.Td ta="right" fw={600} className="tabular">
                      {formatKr(r.totalOre)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        )}

        {selected && !returning && (
          <>
            <Paper withBorder radius="md">
              <Table verticalSpacing="sm">
                <Table.Tbody>
                  {selected.lines.map((l) => (
                    <Table.Tr key={l.lineNo}>
                      <Table.Td>
                        {l.quantity} × {l.name}
                        {(selected.returnedQuantities[l.lineNo] ?? 0) > 0 && (
                          <Text span c="dimmed" fz="sm">
                            {' '}
                            {t('(returned {count})', {
                              count: selected.returnedQuantities[l.lineNo]!,
                            })}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {formatKr(l.lineTotalOre)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
            <Group justify="space-between" px="xs">
              <Text fw={600}>{t('Total')}</Text>
              <Text fz="xl" fw={700} className="tabular">
                {formatKr(selected.totalOre)}
              </Text>
            </Group>
            <Group grow>
              <Button
                variant="default"
                size="md"
                leftSection={<IconCopy size={18} />}
                loading={busy}
                disabled={selected.kind === 'copy'}
                onClick={() => run(() => createCopy(selected.id, attemptKey))}
              >
                {t('Print copy')}
              </Button>
              <Tooltip label={t('Managers and owners only')} disabled={canReturn}>
                <Button
                  size="md"
                  color="red"
                  variant="light"
                  leftSection={canReturn ? <IconReceiptRefund size={18} /> : <IconLock size={16} />}
                  disabled={busy || selected.kind !== 'sale' || !canReturn}
                  onClick={() => setReturning(true)}
                >
                  {t('Return…')}
                </Button>
              </Tooltip>
            </Group>
          </>
        )}

        {selected && returning && (
          <ReturnForm
            original={selected}
            busy={busy}
            onSubmit={(lines, method, amountOre) =>
              run(async () => {
                // A sale paid through Swish gets its money back through Swish first.
                const swishRefundId =
                  method === 'swish' && selected.swishRefundableOre > 0
                    ? await refundThroughSwish(selected.id, -amountOre)
                    : undefined;
                return createReturn(
                  {
                    originalReceiptId: selected.id,
                    lines,
                    payments: [{ method, amountOre, ...(swishRefundId && { swishRefundId }) }],
                  },
                  attemptKey,
                );
              })
            }
          />
        )}
      </Stack>
    </Modal>
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
  const viaSwish = method === 'swish' && original.swishRefundableOre > 0;
  const tooMuchForSwish = viaSwish && payOutOre > original.swishRefundableOre;

  return (
    <Stack gap="md">
      <Text fz="sm" c="dimmed">
        {t('Choose how many of each item to return.')}
      </Text>
      <Paper withBorder radius="md">
        <Table verticalSpacing="sm">
          <Table.Tbody>
            {original.lines.map((l) => {
              const left = l.quantity - (original.returnedQuantities[l.lineNo] ?? 0);
              const q = quantities[l.lineNo] ?? 0;
              const set = (n: number) => setQuantities((qs) => ({ ...qs, [l.lineNo]: n }));
              return (
                <Table.Tr key={l.lineNo} opacity={left === 0 ? 0.5 : 1}>
                  <Table.Td>
                    <Text fw={550}>{l.name}</Text>
                    <Text fz="xs" c="dimmed">
                      {t('({count} left)', { count: left })}
                    </Text>
                  </Table.Td>
                  <Table.Td w={150}>
                    <Group gap={6} justify="flex-end" wrap="nowrap">
                      <ActionIcon
                        variant="default"
                        radius="xl"
                        disabled={q === 0}
                        onClick={() => set(q - 1)}
                        aria-label={t('Fewer')}
                      >
                        <IconMinus size={14} />
                      </ActionIcon>
                      <Text w={24} ta="center" fw={600} className="tabular">
                        {q}
                      </Text>
                      <ActionIcon
                        variant="default"
                        radius="xl"
                        disabled={q >= left}
                        onClick={() => set(q + 1)}
                        aria-label={t('More')}
                      >
                        <IconPlus size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Paper>

      <Stack gap={6}>
        <Text fz="sm" fw={600}>
          {t('Refund with')}
        </Text>
        <SegmentedControl
          fullWidth
          value={method}
          onChange={(value) => setMethod(value as PaymentMethod)}
          data={(['card', 'swish', 'cash'] as const).map((m) => ({
            value: m,
            label: t(PAYMENT_LABELS[m]),
          }))}
        />
      </Stack>

      {viaSwish && (
        <Alert
          color={tooMuchForSwish ? 'red' : 'blue'}
          variant="light"
          py="xs"
          icon={<IconDeviceMobile size={18} />}
        >
          {tooMuchForSwish
            ? t('Only {amount} of the Swish payment is left to refund.', {
                amount: formatKr(original.swishRefundableOre),
              })
            : t('The money goes straight back to the guest through Swish.')}
        </Alert>
      )}

      <Group justify="space-between" px="xs">
        <Text fw={600}>{t('Refund')}</Text>
        <Text fz="xl" fw={700} c="red" className="tabular">
          {formatKr(payOutOre)}
        </Text>
      </Group>
      <Button
        size="md"
        color="red"
        loading={busy}
        disabled={lines.length === 0 || tooMuchForSwish}
        onClick={() => onSubmit(lines, method, -payOutOre)}
      >
        {busy && viaSwish ? t('Refunding through Swish…') : t('Make return')}
      </Button>
    </Stack>
  );
}
