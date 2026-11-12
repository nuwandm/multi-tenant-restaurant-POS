import { AreaChart, BarChart } from '@mantine/charts';
import {
  Card,
  Center,
  Grid,
  Group,
  Loader,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { IconChartBar } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { api, type SalesReport } from '../api';
import { formatKr } from '../format';
import { useT } from '../i18n';
import { PageHeader } from '../PageHeader';
import { useLoad } from '../useLoad';

type Preset = 'today' | '7d' | '30d' | 'month';

/** A date as YYYY-MM-DD in Swedish time, which is how the API counts days. */
const stockholmDay = (d: Date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(d);

function range(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = stockholmDay(now);
  const daysAgo = (n: number) => stockholmDay(new Date(now.getTime() - n * 86_400_000));
  switch (preset) {
    case 'today':
      return { from: to, to };
    case '7d':
      return { from: daysAgo(6), to };
    case '30d':
      return { from: daysAgo(29), to };
    case 'month':
      return { from: `${to.slice(0, 8)}01`, to };
  }
}

const kr = (ore: number) =>
  new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(ore / 100) + ' kr';

/** Sales by day, hour, payment method and item, for owners and managers. */
export function ReportsPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const [preset, setPreset] = useState<Preset>('7d');
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const restaurants = useLoad(() => api.restaurants(tenantId), [tenantId]);
  const { from, to } = range(preset);
  const { data, error } = useLoad(
    () => api.salesReport(tenantId, from, to, restaurantId),
    [tenantId, from, to, restaurantId],
  );
  const list = restaurants.data?.restaurants ?? [];

  return (
    <>
      <PageHeader
        title={t('Sales')}
        description={t(
          'Sales and returns in Swedish time. Training receipts and copies are left out.',
        )}
        actions={
          <Group gap="sm">
            {list.length > 1 && (
              <Select
                aria-label={t('Restaurant')}
                value={restaurantId ?? ''}
                onChange={(v) => setRestaurantId(v || null)}
                allowDeselect={false}
                data={[
                  { value: '', label: t('All restaurants') },
                  ...list.map((r) => ({ value: r.id, label: r.name })),
                ]}
                w={200}
              />
            )}
            <SegmentedControl
              value={preset}
              onChange={(v) => setPreset(v as Preset)}
              data={[
                { value: 'today', label: t('Today') },
                { value: '7d', label: t('7 days') },
                { value: '30d', label: t('30 days') },
                { value: 'month', label: t('This month') },
              ]}
            />
          </Group>
        }
      />
      {error && <Text c="red">{t(error)}</Text>}
      {!data && !error && (
        <Center h={320}>
          <Loader type="dots" />
        </Center>
      )}
      {data && <Report report={data} single={preset === 'today'} />}
    </>
  );
}

function Report({ report, single }: { report: SalesReport; single: boolean }) {
  const t = useT();
  const { totals } = report;

  if (totals.receipts === 0 && totals.returns === 0) {
    return (
      <Card withBorder radius="lg" p={48}>
        <Center>
          <Stack align="center" gap="xs" ta="center">
            <ThemeIcon size={48} radius="xl" variant="light">
              <IconChartBar size={24} stroke={1.5} />
            </ThemeIcon>
            <Text fw={600}>{t('No sales in this period')}</Text>
            <Text c="dimmed" fz="sm">
              {t('Sales show up here as soon as receipts are made at the till.')}
            </Text>
          </Stack>
        </Center>
      </Card>
    );
  }

  // Fill the gaps between the first and last trading hour so the shape of the day is honest.
  const hours = report.hours.map((h) => h.hour);
  const hourly =
    hours.length === 0
      ? []
      : Array.from({ length: Math.max(...hours) - Math.min(...hours) + 1 }, (_, i) => {
          const hour = Math.min(...hours) + i;
          const found = report.hours.find((h) => h.hour === hour);
          return { hour: `${String(hour).padStart(2, '0')}:00`, net: (found?.netOre ?? 0) / 100 };
        });
  const daily = report.days.map((d) => ({
    day: new Date(`${d.day}T12:00:00`).toLocaleDateString('sv-SE', {
      day: 'numeric',
      month: 'short',
    }),
    net: d.netOre / 100,
  }));
  const paid = report.payments.reduce((s, p) => s + p.amountOre, 0);
  const paymentLabel = (m: string) =>
    m === 'card' ? t('Card') : m === 'cash' ? t('Cash') : m === 'swish' ? t('Swish') : m;

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
        <Stat label={t('Net sales')} value={formatKr(totals.netOre)} hint={t('incl. VAT')} />
        <Stat label={t('Receipts')} value={String(totals.receipts)} />
        <Stat label={t('Average receipt')} value={formatKr(totals.averageOre)} />
        <Stat
          label={t('Returns')}
          value={formatKr(Math.abs(totals.returnsOre))}
          hint={t('{count} returns', { count: totals.returns })}
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: single ? 1 : 2 }} spacing="md">
        {!single && (
          <ChartCard title={t('Net sales per day')}>
            <AreaChart
              h={240}
              data={daily}
              dataKey="day"
              series={[{ name: 'net', label: t('Net sales'), color: 'brand.6' }]}
              curveType="monotone"
              gridAxis="y"
              withDots={daily.length <= 14}
              strokeWidth={2}
              fillOpacity={0.15}
              valueFormatter={(v) => kr(v * 100)}
              yAxisProps={{ width: 70 }}
            />
          </ChartCard>
        )}
        <ChartCard title={t('Net sales per hour')}>
          <BarChart
            h={240}
            data={hourly}
            dataKey="hour"
            series={[{ name: 'net', label: t('Net sales'), color: 'brand.6' }]}
            gridAxis="y"
            barProps={{ radius: [4, 4, 0, 0] }}
            valueFormatter={(v) => kr(v * 100)}
            yAxisProps={{ width: 70 }}
          />
        </ChartCard>
      </SimpleGrid>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <ChartCard title={t('Payment methods')}>
            <Stack gap="md">
              {report.payments.map((p) => {
                const share = paid > 0 ? (p.amountOre / paid) * 100 : 0;
                return (
                  <Stack key={p.method} gap={6}>
                    <Group justify="space-between">
                      <Text fz="sm" fw={500}>
                        {paymentLabel(p.method)}
                      </Text>
                      <Text fz="sm" className="tabular">
                        {formatKr(p.amountOre)}{' '}
                        <Text span c="dimmed" fz="xs">
                          {Math.round(share)}%
                        </Text>
                      </Text>
                    </Group>
                    <Progress
                      value={share}
                      size="sm"
                      radius="xl"
                      aria-label={paymentLabel(p.method)}
                    />
                  </Stack>
                );
              })}
            </Stack>
          </ChartCard>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <ChartCard title={t('Best sellers')}>
            <Table verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('Item')}</Table.Th>
                  <Table.Th ta="right">{t('Sold')}</Table.Th>
                  <Table.Th ta="right">{t('Net')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {report.topItems.map((i) => (
                  <Table.Tr key={i.name}>
                    <Table.Td>{i.name}</Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {i.quantity}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {formatKr(i.netOre)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ChartCard>
        </Grid.Col>
      </Grid>

      <ChartCard title={t('VAT')}>
        <Table verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('Rate')}</Table.Th>
              <Table.Th ta="right">{t('Excl. VAT')}</Table.Th>
              <Table.Th ta="right">{t('VAT')}</Table.Th>
              <Table.Th ta="right">{t('Incl. VAT')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {report.vat.map((v) => (
              <Table.Tr key={v.vatRate}>
                <Table.Td>{v.vatRate}%</Table.Td>
                <Table.Td ta="right" className="tabular">
                  {formatKr(v.netOre)}
                </Table.Td>
                <Table.Td ta="right" className="tabular">
                  {formatKr(v.vatOre)}
                </Table.Td>
                <Table.Td ta="right" className="tabular">
                  {formatKr(v.netOre + v.vatOre)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ChartCard>
    </Stack>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card withBorder radius="lg" p="lg">
      <Text fz="xs" c="dimmed" tt="uppercase" fw={600} lts={0.4}>
        {label}
      </Text>
      <Text fz={26} fw={650} mt={6} className="tabular">
        {value}
      </Text>
      {hint && (
        <Text fz="xs" c="dimmed" mt={2}>
          {hint}
        </Text>
      )}
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card withBorder radius="lg" p="lg" h="100%">
      <Text fw={600} mb="md">
        {title}
      </Text>
      {children}
    </Card>
  );
}
