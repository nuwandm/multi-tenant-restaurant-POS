import { Alert, Button, List, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconAlertCircle, IconDeviceTablet } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { pairDevice } from './api';
import { useT } from './i18n';
import { StartLayout } from './StartLayout';

interface Props {
  onPaired: () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** First start on a new tablet: enter the code from the back office to become a register. */
export function PairingScreen({ onPaired }: Props) {
  const t = useT();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pairDevice(code, name || t('Till'));
      onPaired();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StartLayout>
      <form onSubmit={submit}>
        <Stack gap="lg">
          <Stack gap={6}>
            <ThemeIcon size={44} radius="md" variant="light">
              <IconDeviceTablet size={24} stroke={1.6} />
            </ThemeIcon>
            <Title order={2} fz={24}>
              {t('Pair this device')}
            </Title>
            <Text c="dimmed" fz="sm">
              {t(
                'Connect this tablet or computer to one of your registers. You only do this once.',
              )}
            </Text>
          </Stack>

          <List type="ordered" spacing={6} fz="sm" c="dimmed">
            <List.Item>
              {t('Log in to the back office and open Restaurants & registers.')}
            </List.Item>
            <List.Item>
              {t('Press Pair device next to the register this device should be.')}
            </List.Item>
            <List.Item>{t('Type the code here. It is valid for 15 minutes.')}</List.Item>
          </List>

          <TextInput
            label={t('Code')}
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="XXXX-XXXX"
            maxLength={12}
            size="lg"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
            styles={{
              input: {
                fontFamily: 'var(--mantine-font-family-monospace)',
                letterSpacing: '0.18em',
                textAlign: 'center',
                fontSize: 24,
              },
            }}
          />
          <TextInput
            label={t('Device name (optional)')}
            placeholder={t('e.g. iPad at the bar')}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />

          {error && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
              {t(error)}
            </Alert>
          )}

          <Button
            type="submit"
            size="lg"
            loading={busy}
            disabled={code.replace(/[\s-]/g, '').length < 8}
          >
            {t('Pair')}
          </Button>
        </Stack>
      </form>
    </StartLayout>
  );
}
