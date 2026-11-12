import { Group, Text, ThemeIcon } from '@mantine/core';
import { IconReceipt2 } from '@tabler/icons-react';

/** Product mark. "inverted" is for dark backgrounds. */
export function Brand({ inverted = false, sub }: { inverted?: boolean; sub?: string }) {
  return (
    <Group gap={10} wrap="nowrap">
      <ThemeIcon size={34} radius="md" variant={inverted ? 'white' : 'filled'}>
        <IconReceipt2 size={20} stroke={1.8} />
      </ThemeIcon>
      <div>
        <Text fw={700} fz="md" lh={1.1} c={inverted ? 'white' : undefined}>
          Kassa
          <Text span inherit c={inverted ? 'brand.2' : 'brand'}>
            Flow
          </Text>
        </Text>
        {sub && (
          <Text fz={11} fw={500} c={inverted ? 'brand.1' : 'dimmed'} tt="uppercase" lts={0.6}>
            {sub}
          </Text>
        )}
      </div>
    </Group>
  );
}
