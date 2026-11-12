import { Badge, Card, Center, Stack, Table, Text, ThemeIcon } from '@mantine/core';
import { IconFileAnalytics } from '@tabler/icons-react';
import { api } from '../api';
import { formatDateTime, formatKr } from '../format';
import { useT } from '../i18n';
import { PageHeader } from '../PageHeader';
import { useLoad } from '../useLoad';
import { TableSkeleton } from './TableSkeleton';

export function ZReportsPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { data, error } = useLoad(() => api.zReports(tenantId), [tenantId]);

  return (
    <>
      <PageHeader
        title={t('Z reports')}
        description={t('Every closed day, per register. Z reports can never be changed.')}
      />
      {error && <Text c="red">{t(error)}</Text>}
      <Card withBorder padding={0} radius="lg">
        {!data && !error && <TableSkeleton />}
        {data?.length === 0 && (
          <Center py={64}>
            <Stack align="center" gap="xs">
              <ThemeIcon size={48} radius="xl" variant="light">
                <IconFileAnalytics size={24} stroke={1.5} />
              </ThemeIcon>
              <Text c="dimmed">
                {t('No Z reports yet. They are taken at the till when the day is closed.')}
              </Text>
            </Stack>
          </Center>
        )}
        {data && data.length > 0 && (
          <Table.ScrollContainer minWidth={820}>
            <Table verticalSpacing="sm" horizontalSpacing="lg" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('Z no.')}</Table.Th>
                  <Table.Th>{t('Restaurant')}</Table.Th>
                  <Table.Th>{t('Period')}</Table.Th>
                  <Table.Th ta="right">{t('Receipts')}</Table.Th>
                  <Table.Th ta="right">{t('Sales')}</Table.Th>
                  <Table.Th ta="right">{t('Returns')}</Table.Th>
                  <Table.Th ta="right">{t('Net')}</Table.Th>
                  <Table.Th ta="right">{t('Grand total')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((z) => (
                  <Table.Tr key={z.id}>
                    <Table.Td>
                      <Badge variant="light" radius="sm" className="tabular">
                        Z {z.zNumber}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text fz="sm" fw={500}>
                        {z.restaurant}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {z.register}
                      </Text>
                    </Table.Td>
                    <Table.Td fz="sm" c="dimmed">
                      {formatDateTime(z.periodFrom)} – {formatDateTime(z.periodTo)}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {z.saleCount}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {formatKr(z.salesTotalOre)}
                    </Table.Td>
                    <Table.Td
                      ta="right"
                      c={z.returnsTotalOre ? 'red' : undefined}
                      className="tabular"
                    >
                      {formatKr(z.returnsTotalOre)}
                    </Table.Td>
                    <Table.Td ta="right" fw={650} className="tabular">
                      {formatKr(z.netTotalOre)}
                    </Table.Td>
                    <Table.Td ta="right" c="dimmed" className="tabular">
                      {formatKr(z.grandTotalOre)}
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
