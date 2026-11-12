import {
  Badge,
  Center,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconArmchair, IconClock } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { listOpenOrders, type DiningTable, type OpenOrder } from './api';
import { formatKr } from './format';
import { useT } from './i18n';

interface Props {
  tables: DiningTable[];
  /** The table whose order is on screen now, if any. */
  currentTableId: string | null;
  onOpen: (table: DiningTable, order: OpenOrder | null) => void;
  onClose: () => void;
}

const minutesSince = (iso: string) =>
  Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));

/** Floor overview: free tables, and occupied ones with their total and how long they've sat. */
export function TablesDialog({ tables, currentTableId, onOpen, onClose }: Props) {
  const t = useT();
  const [orders, setOrders] = useState<OpenOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listOpenOrders()
      .then(setOrders)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const byTable = new Map((orders ?? []).filter((o) => o.tableId).map((o) => [o.tableId!, o]));
  const occupied = byTable.size;

  return (
    <Modal
      opened
      onClose={onClose}
      size="xl"
      title={
        <Group gap="sm">
          <Text fw={650} fz="lg">
            {t('Tables')}
          </Text>
          {orders && (
            <Badge variant="light">
              {t('{busy} of {total} occupied', { busy: occupied, total: tables.length })}
            </Badge>
          )}
        </Group>
      }
    >
      {error && <Text c="red">{t(error)}</Text>}
      {!orders && !error && (
        <Center h={240}>
          <Loader type="dots" />
        </Center>
      )}
      {orders && (
        <SimpleGrid cols={{ base: 2, xs: 3, sm: 4 }} spacing="sm">
          {tables.map((table) => {
            const order = byTable.get(table.id) ?? null;
            const items = order?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
            return (
              <UnstyledButton
                key={table.id}
                className="table-tile"
                data-busy={order !== null}
                data-current={table.id === currentTableId}
                onClick={() => onOpen(table, order)}
              >
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Text fw={650} fz="lg">
                    {table.name}
                  </Text>
                  <IconArmchair size={18} stroke={1.6} className="table-icon" />
                </Group>
                {order ? (
                  <Stack gap={2}>
                    <Text fw={650} className="mono">
                      {formatKr(order.totalOre)}
                    </Text>
                    <Group gap={6} c="dimmed">
                      <IconClock size={13} />
                      <Text fz="xs">
                        {t('{min} min', { min: minutesSince(order.createdAt) })} ·{' '}
                        {t('{count} items', { count: items })}
                      </Text>
                    </Group>
                  </Stack>
                ) : (
                  <Text fz="sm" c="dimmed">
                    {t('Free')}
                  </Text>
                )}
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
      )}
    </Modal>
  );
}
