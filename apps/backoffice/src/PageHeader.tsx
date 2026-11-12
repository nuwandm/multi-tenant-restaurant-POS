import { Group, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

/** Title, one line of context, and the page's main actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-end" mb="lg" gap="md">
      <div>
        <Title order={2} fz={26} lts={-0.3}>
          {title}
        </Title>
        {description && (
          <Text c="dimmed" fz="sm" mt={4}>
            {description}
          </Text>
        )}
      </div>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
}
