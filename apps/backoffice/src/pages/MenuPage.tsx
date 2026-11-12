import {
  Badge,
  Button,
  Card,
  Center,
  Group,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAdjustmentsHorizontal,
  IconList,
  IconPlus,
  IconToolsKitchen2,
} from '@tabler/icons-react';
import type { VatRate } from '@pos/domain';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Article, type MenuGroup, type OptionGroup, type Station } from '../api';
import { formatKr, parseKr } from '../format';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { PageHeader } from '../PageHeader';
import { useAction, useLoad } from '../useLoad';
import { OptionGroupsSection } from './OptionGroupsSection';
import { TableSkeleton } from './TableSkeleton';

const VAT_OPTIONS: { rate: VatRate; label: string }[] = [
  { rate: 12, label: '12% (food)' },
  { rate: 25, label: '25% (alcohol)' },
  { rate: 6, label: '6%' },
  { rate: 0, label: '0%' },
];

const STATION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'No ticket' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bar', label: 'Bar' },
];

/** Menu per restaurant. Changes reach the tills at once; old receipts keep their prices. */
export function MenuPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const restaurants = useLoad(() => api.restaurants(tenantId), [tenantId]);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  useEffect(() => {
    const list = restaurants.data?.restaurants ?? [];
    if (list.length > 0 && !list.some((r) => r.id === restaurantId)) setRestaurantId(list[0]!.id);
  }, [restaurants.data, restaurantId]);

  return (
    <>
      <PageHeader
        title={t('Menu')}
        description={t(
          'Prices include VAT. Changes reach the tills at once; old receipts keep their prices.',
        )}
        actions={
          restaurants.data &&
          restaurants.data.restaurants.length > 1 && (
            <Select
              aria-label={t('Restaurant')}
              allowDeselect={false}
              value={restaurantId}
              onChange={setRestaurantId}
              data={restaurants.data.restaurants.map((r) => ({ value: r.id, label: r.name }))}
              w={240}
            />
          )
        }
      />
      {restaurants.error && <Text c="red">{t(restaurants.error)}</Text>}
      {restaurantId && (
        <MenuEditor key={restaurantId} tenantId={tenantId} restaurantId={restaurantId} />
      )}
    </>
  );
}

function MenuEditor({ tenantId, restaurantId }: { tenantId: string; restaurantId: string }) {
  const t = useT();
  const { data, error, reload } = useLoad(
    () => api.menu(tenantId, restaurantId),
    [tenantId, restaurantId],
  );
  const options = useLoad(() => api.optionGroups(tenantId, restaurantId), [tenantId, restaurantId]);
  const action = useAction({ toast: true });
  const [groupName, setGroupName] = useState('');

  async function addGroup(e: FormEvent) {
    e.preventDefault();
    const sortOrder = (data?.groups.length ?? 0) + 1;
    if (
      await action.run(() => api.addGroup(tenantId, restaurantId, { name: groupName, sortOrder }))
    ) {
      notifyOk(t('{name} is added.', { name: groupName }));
      setGroupName('');
      reload();
    }
  }

  const save = async (fn: () => Promise<unknown>) => {
    if (await action.run(fn)) {
      notifyOk(t('Saved'));
      reload();
      options.reload();
    }
  };

  if (!data) {
    return error ? (
      <Text c="red">{t(error)}</Text>
    ) : (
      <Card withBorder radius="lg" padding={0}>
        <TableSkeleton />
      </Card>
    );
  }

  const sections: { group: MenuGroup | null; articles: Article[] }[] = [
    ...data.groups.map((g) => ({
      group: g,
      articles: data.articles.filter((a) => a.menuGroupId === g.id),
    })),
    { group: null, articles: data.articles.filter((a) => a.menuGroupId === null) },
  ];

  if (data.articles.length === 0 && data.groups.length === 0) {
    return (
      <Card withBorder radius="lg" p={48}>
        <Center>
          <Stack align="center" gap="sm" maw={420} ta="center">
            <ThemeIcon size={56} radius="xl" variant="light">
              <IconToolsKitchen2 size={28} stroke={1.5} />
            </ThemeIcon>
            <Text fw={600} fz="lg">
              {t('Start your menu')}
            </Text>
            <Text c="dimmed">{t('Add a group such as Starters, then add the dishes in it.')}</Text>
            <NewGroupForm
              value={groupName}
              onChange={setGroupName}
              onSubmit={addGroup}
              busy={action.busy}
            />
          </Stack>
        </Center>
      </Card>
    );
  }

  const optionGroups = options.data ?? [];

  return (
    <Tabs defaultValue="items" keepMounted={false}>
      <Tabs.List mb="lg">
        <Tabs.Tab value="items" leftSection={<IconList size={16} />}>
          {t('Items')}
        </Tabs.Tab>
        <Tabs.Tab value="options" leftSection={<IconAdjustmentsHorizontal size={16} />}>
          {t('Options')}
          {optionGroups.length > 0 && (
            <Badge ml={6} size="sm" variant="default">
              {optionGroups.length}
            </Badge>
          )}
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="options">
        <OptionGroupsSection
          tenantId={tenantId}
          restaurantId={restaurantId}
          groups={optionGroups}
          save={save}
          reload={options.reload}
        />
      </Tabs.Panel>
      <Tabs.Panel value="items">
        <Stack gap="lg">
          {sections
            .filter((s) => s.group || s.articles.length > 0)
            .map(({ group, articles }) => (
              <Card
                key={group?.id ?? 'none'}
                withBorder
                radius="lg"
                padding={0}
                opacity={group && !group.active ? 0.6 : 1}
              >
                <Group justify="space-between" p="lg" pb="sm">
                  <Group gap="sm">
                    {group ? (
                      <InlineText
                        value={group.name}
                        fw={650}
                        fz="lg"
                        onSave={(name) => save(() => api.updateGroup(tenantId, group.id, { name }))}
                      />
                    ) : (
                      <Text fw={650} fz="lg" c="dimmed">
                        {t('No group')}
                      </Text>
                    )}
                    <Badge variant="default" radius="sm">
                      {articles.length}
                    </Badge>
                  </Group>
                  {group && (
                    <Switch
                      label={t('Shown at the till')}
                      labelPosition="left"
                      checked={group.active}
                      onChange={(e) =>
                        save(() =>
                          api.updateGroup(tenantId, group.id, { active: e.currentTarget.checked }),
                        )
                      }
                    />
                  )}
                </Group>

                <Table.ScrollContainer minWidth={980}>
                  <Table verticalSpacing="xs" horizontalSpacing="lg" highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t('Item')}</Table.Th>
                        <Table.Th ta="right" w={130}>
                          {t('Price')}
                        </Table.Th>
                        <Table.Th w={160}>{t('VAT')}</Table.Th>
                        <Table.Th w={170}>{t('Group')}</Table.Th>
                        <Table.Th w={130}>{t('Ticket')}</Table.Th>
                        <Table.Th w={210}>{t('Options')}</Table.Th>
                        <Table.Th w={110} ta="center">
                          {t('At the till')}
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {articles.map((a) => (
                        <ArticleRow
                          key={a.id}
                          article={a}
                          groups={data.groups}
                          optionGroups={optionGroups}
                          tenantId={tenantId}
                          save={save}
                        />
                      ))}
                      {articles.length === 0 && (
                        <Table.Tr>
                          <Table.Td colSpan={7}>
                            <Text fz="sm" c="dimmed">
                              {t('No items.')}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                <NewArticleForm
                  groupId={group?.id ?? null}
                  onAdd={(body) => save(() => api.addArticle(tenantId, restaurantId, body))}
                />
              </Card>
            ))}

          <Card withBorder radius="lg" p="lg" style={{ borderStyle: 'dashed' }}>
            <NewGroupForm
              value={groupName}
              onChange={setGroupName}
              onSubmit={addGroup}
              busy={action.busy}
            />
          </Card>
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}

function NewGroupForm({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
}) {
  const t = useT();
  return (
    <form onSubmit={onSubmit}>
      <Group gap="sm">
        <TextInput
          required
          placeholder={t('e.g. Starters')}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          w={260}
        />
        <Button type="submit" variant="default" leftSection={<IconPlus size={16} />} loading={busy}>
          {t('Add group')}
        </Button>
      </Group>
    </form>
  );
}

function ArticleRow({
  article,
  groups,
  optionGroups,
  tenantId,
  save,
}: {
  article: Article;
  groups: MenuGroup[];
  optionGroups: OptionGroup[];
  tenantId: string;
  save: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useT();
  const update = (body: Partial<Omit<Article, 'id'>>) =>
    save(() => api.updateArticle(tenantId, article.id, body));
  return (
    <Table.Tr opacity={article.active ? 1 : 0.5}>
      <Table.Td>
        <InlineText value={article.name} fw={500} onSave={(name) => update({ name })} />
      </Table.Td>
      <Table.Td ta="right">
        <InlineText
          value={(article.priceOre / 100).toFixed(2).replace('.', ',')}
          display={formatKr(article.priceOre)}
          validate={(v) => parseKr(v) !== null}
          onSave={(v) => update({ priceOre: parseKr(v)! })}
          className="tabular"
        />
      </Table.Td>
      <Table.Td>
        <Select
          size="xs"
          allowDeselect={false}
          value={String(article.vatRate)}
          onChange={(v) => v && update({ vatRate: Number(v) as VatRate })}
          data={VAT_OPTIONS.map((o) => ({ value: String(o.rate), label: t(o.label) }))}
        />
      </Table.Td>
      <Table.Td>
        <Select
          size="xs"
          value={article.menuGroupId ?? ''}
          onChange={(v) => update({ menuGroupId: v || null })}
          data={[
            { value: '', label: t('No group') },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
      </Table.Td>
      <Table.Td>
        <Select
          size="xs"
          allowDeselect={false}
          value={article.station ?? ''}
          onChange={(v) => update({ station: (v || null) as Station | null })}
          data={STATION_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
        />
      </Table.Td>
      <Table.Td>
        <MultiSelect
          size="xs"
          placeholder={article.optionGroupIds.length === 0 ? t('None') : undefined}
          value={article.optionGroupIds}
          onChange={(ids) => save(() => api.setArticleOptionGroups(tenantId, article.id, ids))}
          data={optionGroups.map((g) => ({
            value: g.id,
            label: g.name,
            disabled: !g.active && !article.optionGroupIds.includes(g.id),
          }))}
          nothingFoundMessage={t('Make option groups on the Options tab.')}
          clearable={false}
          hidePickedOptions
          comboboxProps={{ withinPortal: true }}
        />
      </Table.Td>
      <Table.Td>
        <Center>
          <Switch
            aria-label={t('Shown at the till')}
            checked={article.active}
            onChange={(e) => update({ active: e.currentTarget.checked })}
          />
        </Center>
      </Table.Td>
    </Table.Tr>
  );
}

function NewArticleForm({
  groupId,
  onAdd,
}: {
  groupId: string | null;
  onAdd: (body: {
    name: string;
    priceOre: number;
    vatRate: VatRate;
    menuGroupId: string | null;
    station: Station | null;
  }) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [vatRate, setVatRate] = useState<VatRate>(12);
  const [station, setStation] = useState<Station | null>('kitchen');
  const priceOre = parseKr(price);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (priceOre === null) return;
    await onAdd({ name, priceOre, vatRate, menuGroupId: groupId, station });
    setName('');
    setPrice('');
  }

  return (
    <form onSubmit={submit}>
      <Group px="lg" py="sm" gap="sm" className="card-footer">
        <TextInput
          required
          size="xs"
          placeholder={t('New item')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <TextInput
          required
          size="xs"
          inputMode="decimal"
          placeholder={t('Price in kr')}
          error={price !== '' && priceOre === null}
          value={price}
          onChange={(e) => setPrice(e.currentTarget.value)}
          w={120}
        />
        <Select
          size="xs"
          allowDeselect={false}
          value={String(vatRate)}
          onChange={(v) => v && setVatRate(Number(v) as VatRate)}
          data={VAT_OPTIONS.map((o) => ({ value: String(o.rate), label: t(o.label) }))}
          w={150}
        />
        <Select
          size="xs"
          aria-label={t('Ticket')}
          allowDeselect={false}
          value={station ?? ''}
          onChange={(v) => setStation((v || null) as Station | null)}
          data={STATION_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
          w={130}
        />
        <Button
          type="submit"
          size="xs"
          leftSection={<IconPlus size={14} />}
          disabled={!name || priceOre === null}
        >
          {t('Add')}
        </Button>
      </Group>
    </form>
  );
}

/** Click to edit; Enter or leaving the field saves, Escape cancels. */
function InlineText({
  value,
  display,
  onSave,
  validate = (v) => v.trim().length > 0,
  className,
  fw,
  fz,
}: {
  value: string;
  display?: string;
  onSave: (value: string) => Promise<void>;
  validate?: (value: string) => boolean;
  className?: string;
  fw?: number;
  fz?: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <UnstyledButton
        className={`inline-edit ${className ?? ''}`}
        title={t('Click to change')}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        <Text span fw={fw} fz={fz} inherit={!fz}>
          {display ?? value}
        </Text>
      </UnstyledButton>
    );
  }

  const commit = async () => {
    setEditing(false);
    if (draft !== value && validate(draft)) await onSave(draft.trim());
  };

  return (
    <TextInput
      autoFocus
      size="xs"
      error={!validate(draft)}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
