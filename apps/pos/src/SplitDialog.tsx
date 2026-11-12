import {
  ActionIcon,
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Table,
  Tabs,
  Text,
} from '@mantine/core';
import {
  IconCash,
  IconCreditCard,
  IconDeviceMobile,
  IconMinus,
  IconPlus,
  IconX,
} from '@tabler/icons-react';
import { ore, roundToKrona, type PaymentMethod } from '@pos/domain';
import { useState } from 'react';
import type { BasketLine } from './basket';
import { formatKr, PAYMENT_LABELS } from './format';
import { useT } from './i18n';

type Payment = { method: PaymentMethod; amountOre: number };

interface Props {
  lines: BasketLine[];
  /** Total to pay for the whole order, after all discounts. */
  totalOre: number;
  busy: boolean;
  /** Pay the whole order with several payments. */
  onPayParts: (payments: Payment[]) => void;
  /** Pay only some items now; the rest stays on the order. */
  onPayItems: (quantities: Record<string, number>, method: PaymentMethod) => void;
  onClose: () => void;
}

const METHODS: { method: PaymentMethod; icon: typeof IconCash }[] = [
  { method: 'card', icon: IconCreditCard },
  { method: 'swish', icon: IconDeviceMobile },
  { method: 'cash', icon: IconCash },
];

/** "We'll pay separately": split by amount, or pay for a selection of items. */
export function SplitDialog({ lines, totalOre, busy, onPayParts, onPayItems, onClose }: Props) {
  const t = useT();
  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      title={
        <Text fw={650} fz="lg">
          {t('Split bill')}
        </Text>
      }
    >
      <Tabs defaultValue="amount" variant="pills" radius="xl">
        <Tabs.List grow mb="md">
          <Tabs.Tab value="amount">{t('By amount')}</Tabs.Tab>
          <Tabs.Tab value="items">{t('By items')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="amount">
          <ByAmount totalOre={totalOre} busy={busy} onPay={onPayParts} />
        </Tabs.Panel>
        <Tabs.Panel value="items">
          <ByItems lines={lines} busy={busy} onPay={onPayItems} />
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}

function ByAmount({
  totalOre,
  busy,
  onPay,
}: {
  totalOre: number;
  busy: boolean;
  onPay: (p: Payment[]) => void;
}) {
  const t = useT();
  const [parts, setParts] = useState<Payment[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [amount, setAmount] = useState<number | ''>('');

  const nonCash = parts.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amountOre, 0);
  const cash = parts.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amountOre, 0);
  // Cash is rounded to whole kronor, so what's left in cash is rounded too.
  const left = totalOre - nonCash - cash;
  const cashDue = parts.some((p) => p.method === 'cash')
    ? roundToKrona(ore(totalOre - nonCash)) - cash
    : left;
  const done = parts.length > 0 && (cashDue === 0 || left === 0);

  function add(amountOre: number) {
    if (amountOre <= 0) return;
    setParts((p) => [...p, { method, amountOre }]);
    setAmount('');
  }

  const rest = method === 'cash' ? roundToKrona(ore(totalOre - nonCash)) - cash : left;

  return (
    <Stack gap="md">
      <Group justify="space-between" p="sm" className="summary-box">
        <Text c="dimmed">{t('Left to pay')}</Text>
        <Text fz={26} fw={650} className="mono">
          {formatKr(Math.max(0, method === 'cash' ? rest : left))}
        </Text>
      </Group>

      {parts.length > 0 && (
        <Table verticalSpacing={6}>
          <Table.Tbody>
            {parts.map((p, i) => (
              <Table.Tr key={i}>
                <Table.Td>{t(PAYMENT_LABELS[p.method])}</Table.Td>
                <Table.Td ta="right" className="mono">
                  {formatKr(p.amountOre)}
                </Table.Td>
                <Table.Td w={40}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}
                    aria-label={t('Remove')}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {!done && (
        <>
          <SegmentedControl
            fullWidth
            value={method}
            onChange={(m) => setMethod(m as PaymentMethod)}
            data={METHODS.map(({ method: m }) => ({ value: m, label: t(PAYMENT_LABELS[m]) }))}
          />
          <Group gap="sm" wrap="nowrap" align="flex-end">
            <NumberInput
              style={{ flex: 1 }}
              label={t('Amount (kr)')}
              min={0}
              decimalScale={2}
              decimalSeparator=","
              hideControls
              value={amount}
              onChange={(v) => setAmount(v === '' ? '' : Number(v))}
            />
            <Button
              variant="default"
              disabled={amount === '' || Math.round(Number(amount) * 100) > Math.max(rest, 0)}
              onClick={() => add(Math.round(Number(amount) * 100))}
            >
              {t('Add')}
            </Button>
            <Button variant="light" disabled={rest <= 0} onClick={() => add(rest)}>
              {t('The rest')}
            </Button>
          </Group>
        </>
      )}

      <Button size="lg" h={56} loading={busy} disabled={!done} onClick={() => onPay(parts)}>
        {t('Complete payment')}
      </Button>
    </Stack>
  );
}

function ByItems({
  lines,
  busy,
  onPay,
}: {
  lines: BasketLine[];
  busy: boolean;
  onPay: (quantities: Record<string, number>, method: PaymentMethod) => void;
}) {
  const t = useT();
  const [qty, setQty] = useState<Record<string, number>>({});
  const set = (key: string, n: number) => setQty((q) => ({ ...q, [key]: n }));
  const amount = lines.reduce((sum, l) => {
    const n = qty[l.key] ?? 0;
    const perUnitDiscount = l.quantity > 0 ? l.discountOre / l.quantity : 0;
    return sum + Math.round(n * (l.unitPriceOre - perUnitDiscount));
  }, 0);
  const any = Object.values(qty).some((n) => n > 0);
  const all = lines.every((l) => (qty[l.key] ?? 0) === l.quantity);

  return (
    <Stack gap="md">
      <Text fz="sm" c="dimmed">
        {t('Choose what this guest pays for. The rest stays on the order.')}
      </Text>
      <Table verticalSpacing="xs">
        <Table.Tbody>
          {lines.map((l) => {
            const n = qty[l.key] ?? 0;
            return (
              <Table.Tr key={l.key}>
                <Table.Td>
                  <Text fw={500}>{l.name}</Text>
                  {l.options && (
                    <Text fz="xs" c="dimmed">
                      {l.options}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td w={150}>
                  <Group gap={6} justify="flex-end" wrap="nowrap">
                    <ActionIcon
                      variant="default"
                      radius="xl"
                      disabled={n === 0}
                      onClick={() => set(l.key, n - 1)}
                      aria-label={t('Fewer')}
                    >
                      <IconMinus size={14} />
                    </ActionIcon>
                    <Text w={44} ta="center" fw={600} className="tabular">
                      {n}/{l.quantity}
                    </Text>
                    <ActionIcon
                      variant="default"
                      radius="xl"
                      disabled={n >= l.quantity}
                      onClick={() => set(l.key, n + 1)}
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
      <Group justify="space-between" p="sm" className="summary-box">
        <Text c="dimmed">{t('This guest pays')}</Text>
        <Text fz={22} fw={650} className="mono">
          {formatKr(amount)}
        </Text>
      </Group>
      {all && (
        <Text fz="xs" c="dimmed" ta="center">
          {t('That is the whole order. Close this and pay normally.')}
        </Text>
      )}
      <Group grow>
        {METHODS.map(({ method, icon: Icon }) => (
          <Button
            key={method}
            size="md"
            variant={method === 'card' ? 'filled' : 'default'}
            leftSection={<Icon size={18} />}
            loading={busy}
            disabled={!any || all}
            onClick={() => onPay(qty, method)}
          >
            {t(PAYMENT_LABELS[method])}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}
