import { Badge, Button, Card, Group, Table, Text, ThemeIcon } from '@mantine/core';
import { IconDeviceMobile } from '@tabler/icons-react';
import { useEffect } from 'react';
import { api, type UnusedSwishPayment } from '../api';
import { useConfirm } from '../confirm';
import { formatDateTime, formatKr } from '../format';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { useAction, useLoad } from '../useLoad';

/**
 * Swish money a guest paid that never got a receipt, e.g. the till was closed right after.
 * The till uses it again for the same amount; otherwise an owner gives it back from here.
 * Shown only when there is something to do.
 */
export function UnusedSwishCard({ tenantId }: { tenantId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const { data, reload } = useLoad(() => api.unusedSwish(tenantId), [tenantId]);
  const action = useAction({ toast: true });
  const waiting = data?.some((p) => p.refund?.status === 'pending') ?? false;

  // A refund takes seconds: look again until it has gone through.
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(reload, 3000);
    return () => clearTimeout(timer);
  }, [waiting, data, reload]);

  if (!data || data.length === 0) return null;

  async function refund(p: UnusedSwishPayment) {
    const ok = await confirm({
      title: t('Refund {amount}?', { amount: formatKr(p.amountOre) }),
      message: t(
        'The money goes back to the guest through Swish. Only do this if the guest did not get a receipt for it.',
      ),
      confirmLabel: t('Refund'),
      danger: true,
    });
    if (ok && (await action.run(() => api.refundUnusedSwish(tenantId, p.id)))) {
      notifyOk(t('The refund is on its way.'));
      reload();
    }
  }

  return (
    <Card
      withBorder
      radius="lg"
      padding={0}
      mb="lg"
      style={{ borderColor: 'var(--mantine-color-orange-4)' }}
    >
      <Group gap="sm" p="lg" pb="sm" wrap="nowrap" align="flex-start">
        <ThemeIcon color="orange" variant="light" size={34} radius="md">
          <IconDeviceMobile size={18} stroke={1.7} />
        </ThemeIcon>
        <div>
          <Text fw={650}>{t('Swish payments without a receipt')}</Text>
          <Text fz="sm" c="dimmed">
            {t(
              'The guest paid, but no receipt was made. The till uses the money again for the same amount; otherwise refund it.',
            )}
          </Text>
        </div>
      </Group>
      <Table.ScrollContainer minWidth={640}>
        <Table verticalSpacing="sm" horizontalSpacing="lg">
          <Table.Tbody>
            {data.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td fw={600} className="tabular">
                  {formatKr(p.amountOre)}
                </Table.Td>
                <Table.Td fz="sm">
                  {p.restaurant} · {p.register}
                </Table.Td>
                <Table.Td fz="sm" c="dimmed">
                  {p.paidAt && formatDateTime(p.paidAt)} · {p.takenBy}
                </Table.Td>
                <Table.Td ta="right" w={190}>
                  {p.refund?.status === 'pending' ? (
                    <Badge variant="light" color="blue">
                      {t('Refund on its way')}
                    </Badge>
                  ) : (
                    <Group gap={8} justify="flex-end" wrap="nowrap">
                      {p.refund && (
                        <Badge variant="light" color="red" title={p.refund.errorCode ?? undefined}>
                          {t('Refund failed')}
                        </Badge>
                      )}
                      <Button
                        size="xs"
                        variant="light"
                        color="orange"
                        loading={action.busy}
                        onClick={() => refund(p)}
                      >
                        {p.refund ? t('Try again') : t('Refund')}
                      </Button>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}
