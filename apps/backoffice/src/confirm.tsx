import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useT } from './i18n';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(async () => false);

/** In-app confirmation dialog instead of the browser's window.confirm. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(ok: boolean) => void>(() => {});

  const confirm = useCallback<Confirm>(
    (next) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOptions(next);
      }),
    [],
  );

  const close = (ok: boolean) => {
    resolver.current(ok);
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        opened={options !== null}
        onClose={() => close(false)}
        title={<Text fw={650}>{options?.title}</Text>}
        size="sm"
      >
        <Stack gap="lg">
          <Text fz="sm" c="dimmed">
            {options?.message}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => close(false)}>
              {t('Cancel')}
            </Button>
            <Button
              color={options?.danger ? 'red' : undefined}
              onClick={() => close(true)}
              data-autofocus
            >
              {options?.confirmLabel}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
