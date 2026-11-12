import { Button, Center, Loader, Stack, Text, Title } from '@mantine/core';
import { IconPlugConnectedX } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import {
  currentStaff,
  getDevice,
  logout,
  setLoggedOutHandler,
  setUnpairedHandler,
  type DeviceInfo,
  type Staff,
} from './api';
import { App } from './App';
import { useT } from './i18n';
import { LoginScreen } from './LoginScreen';
import { PairingScreen } from './PairingScreen';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Pair the device first, then a staff member logs in, then the till. */
export function Root() {
  const t = useT();
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const info = await getDevice();
      setDevice(info);
      setStaff(info ? await currentStaff() : null);
    } catch (err) {
      setError(message(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    setLoggedOutHandler(() => setStaff(null));
    setUnpairedHandler(() => {
      setStaff(null);
      setDevice(null);
    });
    void start();
  }, [start]);

  if (checking) {
    return (
      <Center h="100%">
        <Loader color="brand" type="dots" />
      </Center>
    );
  }
  if (error) {
    return (
      <Center h="100%" p="md">
        <Stack align="center" gap="sm" maw={420} ta="center">
          <IconPlugConnectedX size={40} stroke={1.4} color="var(--mantine-color-gray-6)" />
          <Title order={3}>{t('The till could not start')}</Title>
          <Text c="dimmed">{t(error)}</Text>
          <Button mt="sm" onClick={() => void start()}>
            {t('Try again')}
          </Button>
        </Stack>
      </Center>
    );
  }
  if (!device) return <PairingScreen onPaired={() => void start()} />;
  if (!staff) return <LoginScreen device={device} onLoggedIn={setStaff} />;
  return (
    <App
      staff={staff}
      device={device}
      onLogout={() => {
        void logout().finally(() => setStaff(null));
      }}
    />
  );
}
