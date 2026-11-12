import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  Group,
  NumberInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { IconAdjustmentsHorizontal, IconEye, IconEyeOff, IconPlus } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { api, type OptionGroup } from '../api';
import { formatKr, parseKr } from '../format';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { useAction } from '../useLoad';

type Save = (fn: () => Promise<unknown>) => Promise<void>;

/** Sizes and extras. A group is linked to items on the Items tab; the till asks for it on sale. */
export function OptionGroupsSection({
  tenantId,
  restaurantId,
  groups,
  save,
  reload,
}: {
  tenantId: string;
  restaurantId: string;
  groups: OptionGroup[];
  save: Save;
  reload: () => void;
}) {
  const t = useT();
  return (
    <Stack gap="lg">
      {groups.length === 0 && (
        <Card withBorder radius="lg" p={40}>
          <Center>
            <Stack align="center" gap="sm" maw={440} ta="center">
              <ThemeIcon size={52} radius="xl" variant="light">
                <IconAdjustmentsHorizontal size={26} stroke={1.5} />
              </ThemeIcon>
              <Text fw={600} fz="lg">
                {t('No options yet')}
              </Text>
              <Text c="dimmed">
                {t(
                  'Make a group such as Size (choose 1) or Extras (optional), add choices with their extra price, then link it to items.',
                )}
              </Text>
            </Stack>
          </Center>
        </Card>
      )}
      {groups.map((g) => (
        <GroupCard key={g.id} tenantId={tenantId} group={g} save={save} />
      ))}
      <NewGroupCard tenantId={tenantId} restaurantId={restaurantId} onAdded={reload} />
    </Stack>
  );
}

function ruleText(t: ReturnType<typeof useT>, min: number, max: number) {
  if (min === 0) return max === 1 ? t('Optional') : t('Optional, up to {count}', { count: max });
  return min === max ? t('Choose {count}', { count: min }) : t('Choose {min}–{max}', { min, max });
}

function GroupCard({
  tenantId,
  group,
  save,
}: {
  tenantId: string;
  group: OptionGroup;
  save: Save;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const priceOre = price === '' ? 0 : parseKr(price.replace(/^\+/, ''));

  async function addOption(e: FormEvent) {
    e.preventDefault();
    if (priceOre === null || !name.trim()) return;
    await save(() =>
      api.addOption(tenantId, group.id, { name: name.trim(), priceDeltaOre: priceOre }),
    );
    setName('');
    setPrice('');
  }

  return (
    <Card withBorder radius="lg" padding={0} opacity={group.active ? 1 : 0.6}>
      <Group justify="space-between" p="lg" pb="sm" wrap="wrap">
        <Group gap="sm">
          <Text fw={650} fz="lg">
            {group.name}
          </Text>
          <Badge
            variant={group.minSelect > 0 ? 'light' : 'default'}
            color={group.minSelect > 0 ? 'orange' : 'gray'}
          >
            {ruleText(t, group.minSelect, group.maxSelect)}
          </Badge>
        </Group>
        <Group gap="md">
          <NumberInput
            size="xs"
            w={90}
            label={t('Min')}
            min={0}
            max={group.maxSelect}
            value={group.minSelect}
            onBlur={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isInteger(v) && v !== group.minSelect && v <= group.maxSelect)
                void save(() => api.updateOptionGroup(tenantId, group.id, { minSelect: v }));
            }}
          />
          <NumberInput
            size="xs"
            w={90}
            label={t('Max')}
            min={Math.max(1, group.minSelect)}
            max={20}
            value={group.maxSelect}
            onBlur={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isInteger(v) && v !== group.maxSelect && v >= Math.max(1, group.minSelect))
                void save(() => api.updateOptionGroup(tenantId, group.id, { maxSelect: v }));
            }}
          />
          <Switch
            mt={18}
            label={t('In use')}
            labelPosition="left"
            checked={group.active}
            onChange={(e) =>
              save(() =>
                api.updateOptionGroup(tenantId, group.id, { active: e.currentTarget.checked }),
              )
            }
          />
        </Group>
      </Group>

      <Table verticalSpacing={6} horizontalSpacing="lg">
        <Table.Tbody>
          {group.options.map((o) => (
            <Table.Tr key={o.id} opacity={o.active ? 1 : 0.5}>
              <Table.Td td={o.active ? undefined : 'line-through'}>{o.name}</Table.Td>
              <Table.Td
                ta="right"
                w={140}
                className="tabular"
                c={o.priceDeltaOre === 0 ? 'dimmed' : undefined}
              >
                {o.priceDeltaOre === 0
                  ? t('No extra cost')
                  : `${o.priceDeltaOre > 0 ? '+' : '−'}${formatKr(Math.abs(o.priceDeltaOre))}`}
              </Table.Td>
              <Table.Td w={48}>
                <Tooltip label={o.active ? t('Hide from the till') : t('Show at the till')}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={o.active ? t('Hide from the till') : t('Show at the till')}
                    onClick={() =>
                      save(() => api.updateOption(tenantId, o.id, { active: !o.active }))
                    }
                  >
                    {o.active ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                  </ActionIcon>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
          {group.options.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Text fz="sm" c="dimmed">
                  {t('No choices yet.')}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <form onSubmit={addOption}>
        <Group px="lg" py="sm" gap="sm" className="card-footer">
          <TextInput
            required
            size="xs"
            placeholder={t('New choice, e.g. Large')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
          <TextInput
            size="xs"
            inputMode="decimal"
            placeholder={t('Extra kr, e.g. 15')}
            error={priceOre === null}
            value={price}
            onChange={(e) => setPrice(e.currentTarget.value)}
            w={140}
          />
          <Button
            type="submit"
            size="xs"
            leftSection={<IconPlus size={14} />}
            disabled={!name.trim() || priceOre === null}
          >
            {t('Add')}
          </Button>
        </Group>
      </form>
    </Card>
  );
}

function NewGroupCard({
  tenantId,
  restaurantId,
  onAdded,
}: {
  tenantId: string;
  restaurantId: string;
  onAdded: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [min, setMin] = useState<number>(0);
  const [max, setMax] = useState<number>(1);
  const action = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (
      await action.run(() =>
        api.addOptionGroup(tenantId, restaurantId, {
          name: name.trim(),
          minSelect: min,
          maxSelect: max,
        }),
      )
    ) {
      notifyOk(t('{name} is added.', { name: name.trim() }));
      setName('');
      setMin(0);
      setMax(1);
      onAdded();
    }
  }

  return (
    <Card withBorder radius="lg" p="lg" style={{ borderStyle: 'dashed' }}>
      <form onSubmit={submit}>
        <Group gap="sm" align="flex-end">
          <TextInput
            required
            label={t('New option group')}
            placeholder={t('e.g. Size or Extras')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            w={240}
            error={action.error ? t(action.error) : undefined}
          />
          <NumberInput
            label={t('Min')}
            w={80}
            min={0}
            max={20}
            value={min}
            onChange={(v) => setMin(Number(v) || 0)}
          />
          <NumberInput
            label={t('Max')}
            w={80}
            min={1}
            max={20}
            value={max}
            onChange={(v) => setMax(Math.max(1, Number(v) || 1))}
            error={max < min}
          />
          <Text fz="xs" c="dimmed" pb={8}>
            {ruleText(t, min, Math.max(max, 1))}
          </Text>
          <Button
            type="submit"
            variant="default"
            leftSection={<IconPlus size={16} />}
            loading={action.busy}
            disabled={!name.trim() || max < min}
          >
            {t('Add group')}
          </Button>
        </Group>
      </form>
    </Card>
  );
}
