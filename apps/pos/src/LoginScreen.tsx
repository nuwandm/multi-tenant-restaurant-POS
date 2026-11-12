import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconAlertCircle, IconArrowLeft, IconBackspace } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { login, type DeviceInfo, type Staff } from './api';
import { useT } from './i18n';
import { StartLayout } from './StartLayout';
import { avatarColor, initials } from './people';

interface Props {
  device: DeviceInfo;
  onLoggedIn: (staff: Staff) => void;
}

export const ROLE_LABELS: Record<Staff['role'], string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
};

const MAX_PIN = 8;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Pick your name, then enter your PIN on the keypad (or the keyboard). */
export function LoginScreen({ device: info, onLoggedIn }: Props) {
  const t = useT();
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function press(key: string) {
    setError(null);
    if (key === 'clear') setPin('');
    else if (key === 'back') setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < MAX_PIN ? p + key : p));
  }

  async function submit() {
    if (!selected || pin.length < 4 || busy) return;
    setBusy(true);
    try {
      onLoggedIn(await login(selected.userId, pin));
    } catch (err) {
      setError(message(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  // Physical keyboard support for desktops.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') void submit();
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const key = (label: string, value = label) => (
    <Button
      key={value}
      variant="default"
      size="xl"
      h={64}
      fz={24}
      fw={500}
      onClick={() => press(value)}
    >
      {label}
    </Button>
  );

  return (
    <StartLayout width={selected ? 400 : 640}>
      <Stack gap="lg">
        <div>
          <Text fz="xs" fw={600} tt="uppercase" c="dimmed" lts={0.6}>
            {info.company.legalName}
          </Text>
          <Title order={2} fz={26}>
            {info.restaurant.name}
          </Title>
          <Group gap={6} mt={6}>
            <Badge variant="light" radius="sm">
              {t('Register {name}', { name: info.register.designation })}
            </Badge>
            <Badge variant="default" radius="sm">
              {info.device.name}
            </Badge>
          </Group>
        </div>

        {info.company.status === 'pending' && (
          <Alert color="orange" variant="light" icon={<IconAlertCircle size={18} />}>
            {t('The company is waiting for approval. You can log in and train, but not sell yet.')}
          </Alert>
        )}

        {!selected ? (
          <>
            <Text fw={600}>{t('Who are you?')}</Text>
            {info.staff.length === 0 ? (
              <Text c="dimmed">{t('No staff with a PIN. Add staff in the back office.')}</Text>
            ) : (
              <SimpleGrid cols={{ base: 2, xs: 3, sm: 4 }} spacing="sm">
                {info.staff.map((s) => (
                  <UnstyledButton
                    key={s.userId}
                    className="staff-tile"
                    onClick={() => {
                      setSelected(s);
                      setPin('');
                      setError(null);
                    }}
                  >
                    <Avatar
                      size={52}
                      radius="xl"
                      color={avatarColor(s.displayName)}
                      variant="light"
                    >
                      {initials(s.displayName)}
                    </Avatar>
                    <Text fw={600} ta="center" lineClamp={1}>
                      {s.displayName}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {t(ROLE_LABELS[s.role])}
                    </Text>
                  </UnstyledButton>
                ))}
              </SimpleGrid>
            )}
          </>
        ) : (
          <Stack gap="md">
            <Group gap="sm">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                onClick={() => setSelected(null)}
                aria-label={t('← Change person')}
              >
                <IconArrowLeft size={20} />
              </ActionIcon>
              <Avatar radius="xl" color={avatarColor(selected.displayName)} variant="light">
                {initials(selected.displayName)}
              </Avatar>
              <div>
                <Text fw={600}>{selected.displayName}</Text>
                <Text fz="sm" c="dimmed">
                  {t('Enter your PIN')}
                </Text>
              </div>
            </Group>

            <div
              className="pin-dots"
              aria-label={t('{count} digits entered', { count: pin.length })}
            >
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <span key={i} data-filled={i < pin.length} />
              ))}
            </div>

            {error && (
              <Alert color="red" variant="light" py="xs">
                {t(error)}
              </Alert>
            )}

            <SimpleGrid cols={3} spacing="xs">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => key(k))}
              <Button variant="subtle" color="gray" size="xl" h={64} onClick={() => press('clear')}>
                {t('Clear')}
              </Button>
              {key('0')}
              <Button
                variant="subtle"
                color="gray"
                size="xl"
                h={64}
                onClick={() => press('back')}
                aria-label={t('Delete')}
              >
                <IconBackspace size={24} stroke={1.6} />
              </Button>
            </SimpleGrid>

            <Button size="lg" loading={busy} disabled={pin.length < 4} onClick={submit}>
              {t('Log in')}
            </Button>
          </Stack>
        )}
      </Stack>
    </StartLayout>
  );
}
