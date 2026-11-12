import { Badge, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconDeviceMobile } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { api, type Restaurant } from '../api';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { useAction } from '../useLoad';

/** "123 456 78 90", "123-4567890" -> "1234567890"; null unless it is a Swish Handel number. */
export function parseSwishNumber(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^123\d{7}$/.test(digits) ? digits : null;
}

const formatSwishNumber = (n: string) =>
  `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;

/** The restaurant's Swish number. With one set, the till takes Swish through a QR code. */
export function SwishSection({
  tenantId,
  restaurant,
  onChanged,
}: {
  tenantId: string;
  restaurant: Restaurant;
  onChanged: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const action = useAction();
  const parsed = parseSwishNumber(value);

  async function save(swishNumber: string | null) {
    if (await action.run(() => api.updateRestaurant(tenantId, restaurant.id, { swishNumber }))) {
      notifyOk(t('Saved'));
      setEditing(false);
      setValue('');
      onChanged();
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (parsed) await save(parsed);
  }

  return (
    <Stack gap="sm" px="lg" py="md" className="card-footer">
      <Group justify="space-between" wrap="wrap">
        <Group gap={8}>
          <IconDeviceMobile size={16} stroke={1.7} />
          <Text fw={600} fz="sm">
            {t('Swish')}
          </Text>
          {restaurant.swishNumber ? (
            <Badge variant="light" color="teal" className="tabular">
              {formatSwishNumber(restaurant.swishNumber)}
            </Badge>
          ) : (
            <Badge variant="default">{t('Not set up')}</Badge>
          )}
        </Group>
        {!editing && (
          <Group gap="xs">
            {restaurant.swishNumber && (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                loading={action.busy}
                onClick={() => save(null)}
              >
                {t('Remove')}
              </Button>
            )}
            <Button size="xs" variant="default" onClick={() => setEditing(true)}>
              {restaurant.swishNumber ? t('Change') : t('Add Swish number')}
            </Button>
          </Group>
        )}
      </Group>
      {!editing && (
        <Text fz="xs" c="dimmed">
          {restaurant.swishNumber
            ? t(
                'The till shows guests a QR code and makes the receipt once Swish confirms payment.',
              )
            : t(
                'Add the Swish Handel number from your bank so the till can take Swish by QR code.',
              )}
        </Text>
      )}
      {editing && (
        <form onSubmit={submit}>
          <Group gap="sm" align="flex-start">
            <TextInput
              size="xs"
              autoFocus
              inputMode="numeric"
              placeholder="123 456 78 90"
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              error={
                (value !== '' && !parsed
                  ? t('A Swish Handel number is 10 digits and starts with 123.')
                  : undefined) ?? (action.error ? t(action.error) : undefined)
              }
              w={220}
            />
            <Button type="submit" size="xs" disabled={!parsed} loading={action.busy}>
              {t('Save')}
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </Button>
          </Group>
        </form>
      )}
    </Stack>
  );
}
