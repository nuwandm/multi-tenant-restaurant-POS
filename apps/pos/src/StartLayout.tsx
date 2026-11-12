import { Box, Center, Group, Paper } from '@mantine/core';
import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { ColorSchemeToggle, LanguageToggle } from './i18n';

/** Frame for the screens before selling: pairing and staff login. */
export function StartLayout({ children, width = 460 }: { children: ReactNode; width?: number }) {
  return (
    <Box mih="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      <Group justify="space-between" px="lg" py="md">
        <Brand />
        <Group gap="xs">
          <LanguageToggle />
          <ColorSchemeToggle />
        </Group>
      </Group>
      <Center style={{ flex: 1 }} px="md" pb="xl">
        <Paper withBorder shadow="sm" p={{ base: 'lg', sm: 32 }} w="100%" maw={width}>
          {children}
        </Paper>
      </Center>
    </Box>
  );
}
