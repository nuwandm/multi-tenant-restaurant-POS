import { Group, NumberInput, SegmentedControl, SimpleGrid, Button } from '@mantine/core';
import { ore, percentOf } from '@pos/domain';
import { useT } from './i18n';

export type DiscountMode = 'percent' | 'kr';

/** Converts what the cashier typed into öre, capped at the amount. */
export function discountOre(amountOre: number, mode: DiscountMode, value: number | ''): number {
  if (value === '' || value <= 0) return 0;
  const raw =
    mode === 'percent' ? percentOf(ore(amountOre), Math.min(value, 100)) : Math.round(value * 100);
  return Math.min(raw, amountOre);
}

/** Percent or kronor, with quick percentages. */
export function DiscountInput({
  mode,
  value,
  onMode,
  onValue,
}: {
  mode: DiscountMode;
  value: number | '';
  onMode: (mode: DiscountMode) => void;
  onValue: (value: number | '') => void;
}) {
  const t = useT();
  return (
    <>
      <Group gap="sm" align="flex-end" wrap="nowrap">
        <SegmentedControl
          value={mode}
          onChange={(m) => {
            onMode(m as DiscountMode);
            onValue('');
          }}
          data={[
            { value: 'percent', label: '%' },
            { value: 'kr', label: 'kr' },
          ]}
        />
        <NumberInput
          style={{ flex: 1 }}
          aria-label={t('Discount')}
          min={0}
          max={mode === 'percent' ? 100 : undefined}
          decimalScale={2}
          decimalSeparator=","
          hideControls
          placeholder="0"
          value={value}
          onChange={(v) => onValue(v === '' ? '' : Number(v))}
        />
      </Group>
      {mode === 'percent' && (
        <SimpleGrid cols={4} spacing={6}>
          {[5, 10, 15, 20].map((p) => (
            <Button key={p} variant={value === p ? 'light' : 'default'} onClick={() => onValue(p)}>
              {p}%
            </Button>
          ))}
        </SimpleGrid>
      )}
    </>
  );
}
