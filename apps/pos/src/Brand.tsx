import { Group, Text, ThemeIcon } from '@mantine/core';
import { IconReceipt2 } from '@tabler/icons-react';

/** Product mark used on the start screens and in the top bar. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Group gap={8} wrap="nowrap">
      <ThemeIcon size={compact ? 30 : 36} radius="md" variant="filled">
        <IconReceipt2 size={compact ? 18 : 22} stroke={1.8} />
      </ThemeIcon>
      {!compact && (
        <Text fw={700} fz="lg" lts={-0.2}>
          Kassa
          <Text span c="brand" inherit>
            Flow
          </Text>
        </Text>
      )}
    </Group>
  );
}
