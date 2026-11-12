import { Box, Group, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBuildingStore, IconChartBar, IconShieldCheck } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { ColorSchemeToggle, LanguageToggle, useT } from './i18n';

/** Two-column frame for login, sign-up and email-link pages. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const features = [
    {
      icon: IconShieldCheck,
      title: t('Built for Swedish rules'),
      text: t(
        'Signed receipts, X and Z reports and a tamper-proof journal, ready for Skatteverket.',
      ),
    },
    {
      icon: IconBuildingStore,
      title: t('Every branch in one place'),
      text: t('Run several companies and restaurants, each with its own registers and staff.'),
    },
    {
      icon: IconChartBar,
      title: t('Know your day'),
      text: t("See today's sales per restaurant the moment they happen."),
    },
  ];

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing={0} mih="100vh">
      <Box className="auth-aside" p={56} visibleFrom="md">
        <Stack h="100%" justify="space-between" maw={480}>
          <Brand inverted sub={t('Back office')} />
          <Stack gap={40}>
            <div>
              <Text className="eyebrow" c="brand.2" mb="sm">
                {t('Restaurant point of sale')}
              </Text>
              <Title order={1} fz={40} lh={1.12} fw={600} c="white">
                {t('The till and back office for restaurants in Sweden.')}
              </Title>
            </div>
            <Stack gap="lg">
              {features.map((f) => (
                <Group key={f.title} className="feature" align="flex-start" wrap="nowrap" gap="md">
                  <ThemeIcon className="feature-icon" size={36} radius="md">
                    <f.icon size={18} stroke={1.7} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600} c="white" fz="md">
                      {f.title}
                    </Text>
                    <Text fz="sm" c="brand.1" lh={1.55} mt={2}>
                      {f.text}
                    </Text>
                  </div>
                </Group>
              ))}
            </Stack>
          </Stack>
          <Text fz="xs" c="brand.3">
            © {new Date().getFullYear()} KassaFlow
          </Text>
        </Stack>
      </Box>

      <Stack
        className="auth-form"
        p={{ base: 'lg', sm: 56 }}
        justify="center"
        align="center"
        pos="relative"
      >
        <Group pos="absolute" top={20} right={20} gap="xs">
          <LanguageToggle />
          <ColorSchemeToggle />
        </Group>
        <Box hiddenFrom="md" mb="md">
          <Brand sub={t('Back office')} />
        </Box>
        <Box w="100%" maw={400}>
          {children}
        </Box>
      </Stack>
    </SimpleGrid>
  );
}
