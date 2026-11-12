import {
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { IconCash } from '@tabler/icons-react';
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
  const [tendered, setTendered] = useState<number | ''>('');

  const tenderedOre = tendered === '' ? dueOre : Math.round(tendered * 100);
  const valid = Number.isFinite(tenderedOre) && tenderedOre >= dueOre;
  const changeOre = valid ? tenderedOre - dueOre : 0;

  return (
    <Modal
      opened
      onClose={onCancel}
      size="md"
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" size="lg" radius="md">
            <IconCash size={20} stroke={1.6} />
          </ThemeIcon>
          <Text fw={650} fz="lg">
            {t('Cash payment')}
          </Text>
        </Group>
      }
    >
      <Stack gap="md">
        <Paper withBorder p="md" radius="md" bg="var(--mantine-color-default-hover)">
          <Group justify="space-between">
            <Text c="dimmed">{t('To pay')}</Text>
            <Text fz={28} fw={700} className="tabular">
              {formatKr(dueOre)}
            </Text>
          </Group>
          {dueOre !== totalOre && (
            <Text fz="xs" c="dimmed" ta="right">
              {t('Rounded from {amount}', { amount: formatKr(totalOre) })}
            </Text>
          )}
        </Paper>

        <NumberInput
          label={t('Received (kr)')}
          size="lg"
          autoFocus
          min={0}
          decimalScale={2}
          decimalSeparator=","
          thousandSeparator=" "
          hideControls
          placeholder={String(dueOre / 100)}
          value={tendered}
          onChange={(value) => setTendered(value === '' ? '' : Number(value))}
        />

        <SimpleGrid cols={5} spacing={6}>
          <Button variant="light" onClick={() => setTendered('')}>
            {t('Exact')}
          </Button>
          {NOTES.map((n) => (
            <Button
              key={n}
              variant="default"
              disabled={n < dueOre}
              onClick={() => setTendered(n / 100)}
            >
              {n / 100}
            </Button>
          ))}
        </SimpleGrid>

        <Paper
          p="md"
          radius="md"
          bg={valid ? 'var(--mantine-color-brand-light)' : 'var(--mantine-color-red-light)'}
        >
          <Group justify="space-between">
            <Text fw={600} c={valid ? 'brand' : 'red'}>
              {valid ? t('Change') : t('The amount received is not enough')}
            </Text>
            {valid && (
              <Text fz={26} fw={700} c="brand" className="tabular">
                {formatKr(changeOre)}
              </Text>
            )}
          </Group>
        </Paper>

        <Group grow>
          <Button variant="default" size="lg" onClick={onCancel} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button
            size="lg"
            loading={busy}
            disabled={!valid}
            onClick={() => onPay(dueOre, changeOre)}
          >
            {t('Complete')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
