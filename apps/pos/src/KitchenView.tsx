import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Group,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowBackUp,
  IconArrowLeft,
  IconCheck,
  IconChefHat,
  IconPrinter,
  IconSchool,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { listKitchenTickets, setTicketDone, type KitchenTicket, type Station } from './api';
import { ColorSchemeToggle, LanguageToggle, useT } from './i18n';

const STATION_LABELS: Record<Station, string> = { kitchen: 'Kitchen', bar: 'Bar' };

const minutesSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));

/** Kitchen display: open tickets as cards, oldest first, refreshed every few seconds. */
export function KitchenView({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [station, setStation] = useState<Station | 'all'>(() => {
    try {
      return (localStorage.getItem('pos.kitchenStation') as Station | 'all') ?? 'kitchen';
    } catch {
      return 'kitchen';
    }
  });
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listKitchenTickets(station === 'all' ? undefined : station)
        .then((list) => alive && setTickets(list))
        .catch(() => {});
    void load();
    const poll = setInterval(load, 5000);
    const clock = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [station]);

  async function mark(ticket: KitchenTicket, done: boolean) {
    setTickets((list) =>
      list.map((k) =>
        k.id === ticket.id ? { ...k, doneAt: done ? new Date().toISOString() : null } : k,
      ),
    );
    await setTicketDone(ticket.id, done).catch(() => {});
  }

  function chooseStation(value: string) {
    setStation(value as Station | 'all');
    try {
      localStorage.setItem('pos.kitchenStation', value);
    } catch {
      // ignore
    }
  }

  const open = tickets.filter((k) => !k.doneAt);
  const done = tickets.filter((k) => k.doneAt);

  return (
    <Box className="kitchen" h="100%">
      <Group justify="space-between" px="lg" py="md" className="till-header">
        <Group gap="md">
          <ActionIcon
            variant="default"
            size="lg"
            radius="xl"
            onClick={onExit}
            aria-label={t('← Back')}
          >
            <IconArrowLeft size={18} />
          </ActionIcon>
          <ThemeIcon size={36} radius="md" variant="light">
            <IconChefHat size={20} stroke={1.6} />
          </ThemeIcon>
          <div>
            <Title order={3} fw={600}>
              {t('Kitchen display')}
            </Title>
            <Text fz="xs" c="dimmed">
              {t('{count} open tickets', { count: open.length })}
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <SegmentedControl
            value={station}
            onChange={chooseStation}
            data={[
              { value: 'kitchen', label: t('Kitchen') },
              { value: 'bar', label: t('Bar') },
              { value: 'all', label: t('All') },
            ]}
          />
          <LanguageToggle />
          <ColorSchemeToggle />
        </Group>
      </Group>

      <ScrollArea h="calc(100dvh - 70px)" px="lg" py="lg">
        {open.length === 0 ? (
          <Center h={360}>
            <Stack align="center" gap={8}>
              <ThemeIcon size={64} radius="xl" color="gray" variant="light" className="empty-icon">
                <IconCheck size={30} stroke={1.5} />
              </ThemeIcon>
              <Text fw={600} fz="lg">
                {t('All caught up')}
              </Text>
              <Text c="dimmed" fz="sm">
                {t('New orders appear here automatically.')}
              </Text>
            </Stack>
          </Center>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="md">
            {open.map((k) => {
              const age = minutesSince(k.createdAt);
              const urgency = age >= 20 ? 'late' : age >= 10 ? 'warn' : 'ok';
              return (
                <Box key={k.id} className="ticket" data-urgency={urgency}>
                  <Group justify="space-between" className="ticket-head" wrap="nowrap">
                    <div>
                      <Group gap={8}>
                        <Text fw={700} fz="lg">
                          {k.label}
                        </Text>
                        {station === 'all' && (
                          <Badge variant="default">{t(STATION_LABELS[k.station])}</Badge>
                        )}
                        {k.training && (
                          <Badge color="orange" leftSection={<IconSchool size={11} />}>
                            {t('Training')}
                          </Badge>
                        )}
                      </Group>
                      <Text fz="xs" c="dimmed">
                        #{k.ticketNo} · {k.createdBy}
                      </Text>
                    </div>
                    <Badge
                      size="lg"
                      className="ticket-age"
                      variant="light"
                      color={urgency === 'late' ? 'red' : urgency === 'warn' ? 'orange' : 'gray'}
                    >
                      {t('{min} min', { min: age })}
                    </Badge>
                  </Group>
                  <Stack gap={8} p="md">
                    {k.lines.map((l, i) => (
                      <Group key={i} gap="sm" align="flex-start" wrap="nowrap">
                        <Text className="ticket-qty">{l.quantity}×</Text>
                        <div>
                          <Text fw={600} fz="md">
                            {l.name}
                          </Text>
                          {l.options && (
                            <Text fz="sm" c="dimmed">
                              {l.options}
                            </Text>
                          )}
                        </div>
                      </Group>
                    ))}
                  </Stack>
                  <Group gap={8} p="md" pt={0}>
                    <Button
                      flex={1}
                      size="md"
                      leftSection={<IconCheck size={18} />}
                      onClick={() => mark(k, true)}
                    >
                      {t('Done')}
                    </Button>
                    <Tooltip label={t('Print')}>
                      <ActionIcon
                        variant="default"
                        size={42}
                        onClick={() => window.print()}
                        aria-label={t('Print')}
                      >
                        <IconPrinter size={18} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Box>
              );
            })}
          </SimpleGrid>
        )}

        {done.length > 0 && (
          <Stack gap="xs" mt="xl">
            <Text className="eyebrow">{t('Just finished')}</Text>
            <Group gap="xs">
              {done.map((k) => (
                <Button
                  key={k.id}
                  variant="default"
                  size="xs"
                  rightSection={<IconArrowBackUp size={14} />}
                  onClick={() => mark(k, false)}
                >
                  {k.label} · #{k.ticketNo}
                </Button>
              ))}
            </Group>
          </Stack>
        )}
      </ScrollArea>
    </Box>
  );
}
