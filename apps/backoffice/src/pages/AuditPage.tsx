import { Avatar, Card, Code, Group, Text, Timeline } from '@mantine/core';
import {
  IconBuildingStore,
  IconCash,
  IconDeviceTablet,
  IconPencil,
  IconPlus,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { api } from '../api';
import { formatDateTime } from '../format';
import { useT } from '../i18n';
import { PageHeader } from '../PageHeader';
import { avatarColor, initials } from '../people';
import { useLoad } from '../useLoad';
import { TableSkeleton } from './TableSkeleton';

const ACTION_LABELS: Record<string, string> = {
  'company.signup': 'Registered the company',
  'restaurant.create': 'Added a restaurant',
  'restaurant.update': 'Changed a restaurant',
  'swish.refund': 'Refunded a Swish payment',
  'register.create': 'Added a register',
  'register.retire': 'Retired a register',
  'device.pairing_code': 'Created a pairing code',
  'device.revoke': 'Unpaired a device',
  'menu_group.create': 'Added a menu group',
  'menu_group.update': 'Changed a menu group',
  'article.create': 'Added an item',
  'article.update': 'Changed an item',
  'staff.create': 'Added staff',
  'staff.update': 'Changed staff',
  'option_group.create': 'Added an option group',
  'option_group.update': 'Changed an option group',
  'option.create': 'Added an option',
  'option.update': 'Changed an option',
  'article.options': 'Changed the options of an item',
  'table.create': 'Added a table',
  'table.update': 'Changed a table',
};

function actionIcon(action: string): Icon {
  if (action.startsWith('staff')) return IconUsers;
  if (action.startsWith('device')) return IconDeviceTablet;
  if (action.startsWith('register')) return IconCash;
  if (action.startsWith('restaurant') || action.startsWith('company')) return IconBuildingStore;
  return action.endsWith('create') ? IconPlus : IconPencil;
}

/** Who changed what in the back office. The log can't be edited. */
export function AuditPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { data, error } = useLoad(() => api.audit(tenantId), [tenantId]);

  return (
    <>
      <PageHeader
        title={t('Change log')}
        description={t('Every change in the back office, newest first. The log cannot be edited.')}
      />
      {error && <Text c="red">{t(error)}</Text>}
      <Card withBorder radius="lg" p="xl">
        {!data && !error && <TableSkeleton />}
        {data?.length === 0 && <Text c="dimmed">{t('No changes yet.')}</Text>}
        {data && data.length > 0 && (
          <Timeline bulletSize={30} lineWidth={2}>
            {data.map((e, i) => {
              const ActionIcon = actionIcon(e.action);
              const details = Object.entries(e.details).filter(([, v]) => v !== undefined);
              return (
                <Timeline.Item
                  key={i}
                  bullet={<ActionIcon size={15} stroke={1.8} />}
                  title={
                    <Text fw={600} fz="sm">
                      {ACTION_LABELS[e.action] ? t(ACTION_LABELS[e.action]!) : e.action}
                    </Text>
                  }
                >
                  <Group gap={6} mt={4}>
                    <Avatar size={20} radius="xl" color={avatarColor(e.by)} variant="light">
                      {initials(e.by)}
                    </Avatar>
                    <Text fz="xs" c="dimmed">
                      {e.by} · {formatDateTime(e.at)}
                    </Text>
                  </Group>
                  {details.length > 0 && (
                    <Code block mt={8} fz="xs">
                      {details.map(([k, v]) => `${k}: ${String(v)}`).join('\n')}
                    </Code>
                  )}
                </Timeline.Item>
              );
            })}
          </Timeline>
        )}
      </Card>
    </>
  );
}
