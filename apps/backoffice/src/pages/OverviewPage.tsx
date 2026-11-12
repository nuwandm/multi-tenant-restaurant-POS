import {
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
} from '@mantine/core';
import {
  IconBuildingStore,
  IconCalendar,
  IconCoin,
  IconReceipt,
  IconReceiptRefund,
  type Icon,
} from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../api';
import { formatKr, formatOrgNumber } from '../format';
import { useT } from '../i18n';
import { PageHeader } from '../PageHeader';
import { useLoad } from '../useLoad';

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

export function StatCard({
  icon: StatIcon,
  label,
  value,
  hint,
  color = 'brand',
}: {
  icon: Icon;
  label: string;
  value: string | number;
  hint?: string;
  color?: string;
}) {
  return (
    <Card padding="lg">
      <Group gap={8} wrap="nowrap">
        <ThemeIcon color={color} size={26} radius="sm">
          <StatIcon size={15} stroke={1.8} />
        </ThemeIcon>
        <Text fz="sm" fw={500} c="dimmed">
          {label}
        </Text>
      </Group>
      <Text className="stat-value" mt="md">
        {value}
      </Text>
      {hint && (
        <Text fz="xs" c="dimmed" mt={6}>
          {hint}
        </Text>
      )}
    </Card>
  );
}

/** Sales for one day across every company the user manages, each company kept separate. */
export function OverviewPage({ onRegister }: { onRegister: () => void }) {
  const t = useT();
  const [date, setDate] = useState(today);
  const { data, error } = useLoad(() => api.overview(date), [date]);

  const totals = data?.companies.reduce(
    (acc, c) => {
      for (const r of c.restaurants) {
        acc.receipts += r.sales;
        acc.returns += r.returns;
      }
      acc.restaurants += c.restaurants.length;
      return acc;
    },
    { receipts: 0, returns: 0, restaurants: 0 },
  );

  return (
    <>
      <PageHeader
        title={t('Overview')}
        description={t('Sales per company and restaurant for the chosen day.')}
        actions={
          <TextInput
            type="date"
            aria-label={t('Day')}
            leftSection={<IconCalendar size={16} />}
            value={date}
            max={today()}
            onChange={(e) => setDate(e.currentTarget.value || today())}
          />
        }
      />

      {error && <Text c="red">{t(error)}</Text>}

      {!data && !error && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="lg">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={110} radius="lg" />
          ))}
        </SimpleGrid>
      )}

      {data && data.companies.length === 0 && (
        <Card p={48} ta="center">
          <Stack align="center" gap="sm">
            <ThemeIcon size={56} radius="xl" variant="light">
              <IconBuildingStore size={28} stroke={1.5} />
            </ThemeIcon>
            <Text fw={600} fz="lg">
              {t('No company yet')}
            </Text>
            <Text c="dimmed" maw={420}>
              {t('Register your company to set up restaurants, menus and registers.')}
            </Text>
            <Button mt="xs" onClick={onRegister}>
              {t('Register your company')}
            </Button>
          </Stack>
        </Card>
      )}

      {data && totals && data.companies.length > 0 && (
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <StatCard
              icon={IconCoin}
              label={t('Net sales')}
              value={formatKr(data.netOre)}
              hint={date}
            />
            <StatCard
              icon={IconReceipt}
              label={t('Receipts')}
              value={totals.receipts}
              color="indigo"
            />
            <StatCard
              icon={IconReceiptRefund}
              label={t('Returns')}
              value={totals.returns}
              color="red"
            />
            <StatCard
              icon={IconBuildingStore}
              label={t('Restaurants')}
              value={totals.restaurants}
              hint={t('{count} companies', { count: data.companies.length })}
              color="grape"
            />
          </SimpleGrid>

          {data.companies.map((c) => (
            <Card key={c.tenantId} withBorder padding={0} radius="lg">
              <Group justify="space-between" p="lg" pb="md">
                <div>
                  <Text fw={650} fz="lg">
                    {c.legalName}
                  </Text>
                  <Text fz="xs" c="dimmed">
                    {formatOrgNumber(c.orgNumber)}
                  </Text>
                </div>
                <Stack gap={0} align="flex-end">
                  <Text fz="xs" c="dimmed">
                    {t('Net sales')}
                  </Text>
                  <Text fz="xl" fw={700} className="tabular">
                    {formatKr(c.netOre)}
                  </Text>
                </Stack>
              </Group>
              <Table verticalSpacing="sm" horizontalSpacing="lg" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('Restaurant')}</Table.Th>
                    <Table.Th ta="right">{t('Receipts')}</Table.Th>
                    <Table.Th ta="right">{t('Returns')}</Table.Th>
                    <Table.Th ta="right">{t('Net')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {c.restaurants.map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td fw={500}>{r.name}</Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {r.sales}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {r.returns > 0 ? (
                          <Badge color="red" variant="light" radius="sm">
                            {r.returns}
                          </Badge>
                        ) : (
                          0
                        )}
                      </Table.Td>
                      <Table.Td ta="right" fw={600} className="tabular">
                        {formatKr(r.netOre)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          ))}
        </Stack>
      )}
    </>
  );
}
