import { ActionIcon, Button, Divider, Group, Modal, Stack, Text } from '@mantine/core';
import { IconMinus, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { lineGross, type BasketLine } from './basket';
import { DiscountInput, discountOre, type DiscountMode } from './DiscountInput';
import { formatKr } from './format';
import { useT } from './i18n';

interface Props {
  line: BasketLine;
  onSave: (line: BasketLine) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Change quantity or give a discount on one line. */
export function LineDialog({ line, onSave, onRemove, onClose }: Props) {
  const t = useT();
  const [quantity, setQuantity] = useState(line.quantity);
  const [mode, setMode] = useState<DiscountMode>('kr');
  const [value, setValue] = useState<number | ''>(
    line.discountOre > 0 ? line.discountOre / 100 : '',
  );

  const gross = lineGross({ ...line, quantity });
  const discount = discountOre(gross, mode, value);
  // Items already sent to the kitchen can't be reduced below what was sent from here.
  const min = Math.max(1, line.sentQuantity);

  return (
    <Modal
      opened
      onClose={onClose}
      size="sm"
      title={
        <div>
          <Text fw={650} fz="lg">
            {line.name}
          </Text>
          {line.options && (
            <Text fz="sm" c="dimmed">
              {line.options}
            </Text>
          )}
        </div>
      }
    >
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={600}>{t('Quantity')}</Text>
          <Group gap={6} className="qty-pill" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              color="gray"
              radius="xl"
              size={40}
              disabled={quantity <= min}
              onClick={() => setQuantity((q) => q - 1)}
              aria-label={t('Fewer')}
            >
              <IconMinus size={16} />
            </ActionIcon>
            <Text w={32} ta="center" fw={650} fz="lg" className="tabular">
              {quantity}
            </Text>
            <ActionIcon
              variant="subtle"
              color="gray"
              radius="xl"
              size={40}
              onClick={() => setQuantity((q) => q + 1)}
              aria-label={t('More')}
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Group>
        </Group>

        <Divider />
        <Text fw={600}>{t('Discount on this line')}</Text>
        <DiscountInput mode={mode} value={value} onMode={setMode} onValue={setValue} />

        <Stack gap={4} p="sm" className="summary-box">
          <Group justify="space-between">
            <Text fz="sm" c="dimmed">
              {t('{count} × {price}', { count: quantity, price: formatKr(line.unitPriceOre) })}
            </Text>
            <Text fz="sm" className="mono">
              {formatKr(gross)}
            </Text>
          </Group>
          {discount > 0 && (
            <Group justify="space-between">
              <Text fz="sm" c="brand">
                {t('Discount')}
              </Text>
              <Text fz="sm" c="brand" className="mono">
                −{formatKr(discount)}
              </Text>
            </Group>
          )}
          <Group justify="space-between">
            <Text fw={600}>{t('Line total')}</Text>
            <Text fw={650} className="mono">
              {formatKr(gross - discount)}
            </Text>
          </Group>
        </Stack>

        <Group grow>
          <Button
            variant="light"
            color="red"
            leftSection={<IconTrash size={16} />}
            disabled={line.sentQuantity > 0}
            onClick={onRemove}
          >
            {t('Remove')}
          </Button>
          <Button onClick={() => onSave({ ...line, quantity, discountOre: discount })}>
            {t('Save')}
          </Button>
        </Group>
        {line.sentQuantity > 0 && (
          <Text fz="xs" c="dimmed" ta="center">
            {t('{count} already sent to the kitchen.', { count: line.sentQuantity })}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}
