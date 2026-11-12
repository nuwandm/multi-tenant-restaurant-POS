import {
  Avatar,
  Badge,
  Button,
  Card,
  Center,
  Group,
  SegmentedControl,
  SimpleGrid,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBuildingStore,
  IconCircleCheck,
  IconClockHour4,
  IconCoin,
  IconSearch,
} from '@tabler/icons-react';
import { useState } from 'react';
import { api, type CompanyStatus, type PlatformCompany } from '../api';
import { useConfirm } from '../confirm';
import { formatDateTime, formatKr, formatOrgNumber, STATUS_LABELS } from '../format';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { PageHeader } from '../PageHeader';
import { avatarColor, initials } from '../people';
import { useAction, useLoad } from '../useLoad';
import { StatCard } from './OverviewPage';
import { TableSkeleton } from './TableSkeleton';

const STATUS_COLORS: Record<CompanyStatus, string> = {
  pending: 'orange',
  active: 'brand',
  suspended: 'red',
};

/** Platform console: every company's status and usage. No receipts, menus or staff details. */
export function PlatformPage() {
  const t = useT();
  const confirm = useConfirm();
  const { data, error, reload } = useLoad(() => api.platformCompanies(), []);
  const action = useAction({ toast: true });
  const [filter, setFilter] = useState<CompanyStatus | 'all'>('all');
  const [query, setQuery] = useState('');

  const count = (s: CompanyStatus) => data?.filter((c) => c.status === s).length ?? 0;
  const q = query.trim().toLowerCase();
  const companies =
    data?.filter(
      (c) =>
        (filter === 'all' || c.status === filter) &&
        (!q ||
          c.legalName.toLowerCase().includes(q) ||
          c.orgNumber.includes(q.replace('-', '')) ||
          c.owner?.email?.toLowerCase().includes(q)),
    ) ?? [];

  async function change(c: PlatformCompany, act: 'approve' | 'suspend' | 'reactivate') {
    if (act === 'suspend') {
      const ok = await confirm({
        title: t('Suspend {name}?', { name: c.legalName }),
        message: t('Its registers stop selling at once. You can reactivate it later.'),
        confirmLabel: t('Suspend'),
        danger: true,
      });
      if (!ok) return;
    }
    if (await action.run(() => api.setCompanyStatus(c.tenantId, act))) {
      notifyOk(
        act === 'suspend'
          ? t('{name} is suspended.', { name: c.legalName })
          : t('{name} is active.', { name: c.legalName }),
      );
      reload();
    }
  }

  return (
    <>
      <PageHeader
        title={t('Companies')}
        description={t('Every company on the platform. You see status and usage, never receipts.')}
      />

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="lg">
        <StatCard
          icon={IconClockHour4}
          label={t('Waiting for approval')}
          value={count('pending')}
          color="orange"
        />
        <StatCard icon={IconCircleCheck} label={t('Active companies')} value={count('active')} />
        <StatCard
          icon={IconBuildingStore}
          label={t('Restaurants')}
          value={data?.reduce((s, c) => s + c.restaurants, 0) ?? 0}
          color="grape"
        />
        <StatCard
          icon={IconCoin}
          label={t('Sales, 30 days')}
          value={formatKr(data?.reduce((s, c) => s + c.sales30dOre, 0) ?? 0)}
          color="indigo"
        />
      </SimpleGrid>

      <Card withBorder padding={0} radius="lg">
        <Group justify="space-between" p="md" gap="sm">
          <SegmentedControl
            value={filter}
            onChange={(v) => setFilter(v as CompanyStatus | 'all')}
            data={[
              { value: 'all', label: t('All') },
              { value: 'pending', label: `${t('Waiting')} · ${count('pending')}` },
              { value: 'active', label: `${t('Active')} · ${count('active')}` },
              { value: 'suspended', label: `${t('Suspended')} · ${count('suspended')}` },
            ]}
          />
          <TextInput
            placeholder={t('Search name, org. no. or email')}
            leftSection={<IconSearch size={16} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={{ base: '100%', sm: 300 }}
          />
        </Group>

        {error && (
          <Text c="red" px="md" pb="md">
            {t(error)}
          </Text>
        )}
        {!data && !error && <TableSkeleton />}
        {data && companies.length === 0 && (
          <Center py={48}>
            <Text c="dimmed">{t('No companies here.')}</Text>
          </Center>
        )}
        {companies.length > 0 && (
          <Table.ScrollContainer minWidth={980}>
            <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('Company')}</Table.Th>
                  <Table.Th>{t('Owner')}</Table.Th>
                  <Table.Th>{t('Status')}</Table.Th>
                  <Table.Th ta="right">{t('Restaurants')}</Table.Th>
                  <Table.Th ta="right">{t('Registers')}</Table.Th>
                  <Table.Th ta="right">{t('Devices')}</Table.Th>
                  <Table.Th ta="right">{t('Staff')}</Table.Th>
                  <Table.Th>{t('Last sale')}</Table.Th>
                  <Table.Th ta="right">{t('30 days')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {companies.map((c) => (
                  <Table.Tr key={c.tenantId}>
                    <Table.Td>
                      <Text fw={600} fz="sm">
                        {c.legalName}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {formatOrgNumber(c.orgNumber)} ·{' '}
                        {t('signed up {date}', { date: formatDateTime(c.createdAt) })}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {c.owner && (
                        <Group gap="xs" wrap="nowrap">
                          <Avatar
                            size={28}
                            radius="xl"
                            color={avatarColor(c.owner.name)}
                            variant="light"
                          >
                            {initials(c.owner.name)}
                          </Avatar>
                          <div>
                            <Text fz="sm">{c.owner.name}</Text>
                            <Group gap={4}>
                              <Text fz="xs" c="dimmed">
                                {c.owner.email}
                              </Text>
                              {!c.owner.emailVerified && (
                                <Tooltip label={t('Not confirmed')}>
                                  <IconAlertCircle
                                    size={13}
                                    color="var(--mantine-color-orange-6)"
                                  />
                                </Tooltip>
                              )}
                            </Group>
                          </div>
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={STATUS_COLORS[c.status]} radius="sm">
                        {t(STATUS_LABELS[c.status])}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {c.restaurants}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {c.activeRegisters}
                      <Text span c="dimmed">
                        /{c.registers}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {c.devices}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {c.staff}
                    </Table.Td>
                    <Table.Td fz="sm" c={c.lastSaleAt ? undefined : 'dimmed'}>
                      {c.lastSaleAt ? formatDateTime(c.lastSaleAt) : '–'}
                    </Table.Td>
                    <Table.Td ta="right" fw={600} className="tabular">
                      {formatKr(c.sales30dOre)}
                    </Table.Td>
                    <Table.Td ta="right">
                      {c.status === 'pending' && (
                        <Button
                          size="xs"
                          loading={action.busy}
                          onClick={() => change(c, 'approve')}
                        >
                          {t('Approve')}
                        </Button>
                      )}
                      {c.status === 'active' && (
                        <Button
                          size="xs"
                          variant="default"
                          disabled={action.busy}
                          onClick={() => change(c, 'suspend')}
                        >
                          {t('Suspend')}
                        </Button>
                      )}
                      {c.status === 'suspended' && (
                        <Button
                          size="xs"
                          variant="light"
                          loading={action.busy}
                          onClick={() => change(c, 'reactivate')}
                        >
                          {t('Reactivate')}
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </>
  );
}
