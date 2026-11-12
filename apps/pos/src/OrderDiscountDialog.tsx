import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { DiscountInput, discountOre, type DiscountMode } from './DiscountInput';
import { formatKr } from './format';
import { useT } from './i18n';

interface Props {
  /** Order total after line discounts. */
  amountOre: number;
  currentOre: number;
  onSave: (discountOre: number) => void;
  onClose: () => void;
}

/** A discount on the whole order; the API spreads it over the lines so VAT stays right. */
export function OrderDiscountDialog({ amountOre, currentOre, onSave, onClose }: Props) {
  const t = useT();
  const [mode, setMode] = useState<DiscountMode>('percent');
  const [value, setValue] = useState<number | ''>('');
  const discount = value === '' ? currentOre : discountOre(amountOre, mode, value);

  return (
    <Modal
      opened
      onClose={onClose}
      size="sm"
      title={<Text fw={650}>{t('Discount on the order')}</Text>}
    >
      <Stack gap="md">
        <DiscountInput mode={mode} value={value} onMode={setMode} onValue={setValue} />
        <Stack gap={4} p="sm" className="summary-box">
          <Group justify="space-between">
            <Text fz="sm" c="dimmed">
              {t('Order')}
            </Text>
            <Text fz="sm" className="mono">
              {formatKr(amountOre)}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text fz="sm" c="brand">
              {t('Discount')}
            </Text>
            <Text fz="sm" c="brand" className="mono">
              −{formatKr(discount)}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text fw={600}>{t('To pay')}</Text>
            <Text fw={650} className="mono">
              {formatKr(amountOre - discount)}
            </Text>
          </Group>
        </Stack>
        <Group grow>
          <Button variant="default" disabled={currentOre === 0} onClick={() => onSave(0)}>
            {t('Remove discount')}
          </Button>
          <Button onClick={() => onSave(discount)}>{t('Apply')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
