import { ActionIcon, Badge, Button, Group, Menu, Stack, Text, TextInput } from '@mantine/core';
import { IconArmchair, IconDots, IconEye, IconEyeOff, IconPlus } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { api, type Restaurant } from '../api';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { useAction } from '../useLoad';

/** Tables of one restaurant. Tables are hidden, never deleted, so old orders stay readable. */
export function TablesSection({
  tenantId,
  restaurant,
  onChanged,
}: {
  tenantId: string;
  restaurant: Restaurant;
  onChanged: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const add = useAction();
  const toggle = useAction({ toast: true });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const tableName = name.trim();
    if (!tableName) return;
    if (await add.run(() => api.addTable(tenantId, restaurant.id, tableName))) {
      notifyOk(t('{name} is added.', { name: tableName }));
      setName('');
      onChanged();
    }
  }

  const active = restaurant.tables.filter((tb) => tb.active);

  return (
    <Stack gap="sm" px="lg" py="md" className="card-footer">
      <Group justify="space-between">
        <Group gap={8}>
          <IconArmchair size={16} stroke={1.7} />
          <Text fw={600} fz="sm">
            {t('Tables')}
          </Text>
          <Badge variant="default">{active.length}</Badge>
        </Group>
        <Text fz="xs" c="dimmed">
          {t('Tables let the till keep orders open and send them to the kitchen.')}
        </Text>
      </Group>
      {restaurant.tables.length > 0 && (
        <Group gap={6}>
          {restaurant.tables.map((tb) => (
            <Badge
              key={tb.id}
              size="lg"
              variant={tb.active ? 'light' : 'default'}
              color={tb.active ? 'brand' : 'gray'}
              td={tb.active ? undefined : 'line-through'}
              pr={4}
              rightSection={
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon size="xs" variant="transparent" color="gray" aria-label={t('More')}>
                      <IconDots size={12} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={tb.active ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                      onClick={async () => {
                        if (
                          await toggle.run(() =>
                            api.updateTable(tenantId, tb.id, { active: !tb.active }),
                          )
                        )
                          onChanged();
                      }}
                    >
                      {tb.active ? t('Hide from the till') : t('Show at the till')}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              }
            >
              {tb.name}
            </Badge>
          ))}
        </Group>
      )}
      <form onSubmit={submit}>
        <Group gap="sm" align="flex-start">
          <TextInput
            size="xs"
            placeholder={t('New table, e.g. 12 or Terrace 3')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={add.error ? t(add.error) : undefined}
            w={260}
          />
          <Button
            type="submit"
            size="xs"
            variant="default"
            leftSection={<IconPlus size={14} />}
            loading={add.busy}
          >
            {t('Add table')}
          </Button>
        </Group>
      </form>
    </Stack>
  );
}
