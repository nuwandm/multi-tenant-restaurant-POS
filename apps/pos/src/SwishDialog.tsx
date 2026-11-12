import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertCircle, IconCircleCheck, IconTestPipe } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import {
  cancelSwishPayment,
  getSwishPayment,
  simulateSwishPayment,
  startSwishPayment,
  type SwishPayment,
} from './api';
import { formatKr } from './format';
import { useT } from './i18n';

interface Props {
  /** The Swish amounts to collect, one QR code each (a split bill may have several). */
  amounts: number[];
  /** Called for every payment Swish confirms, as soon as it does. */
  onPaid: (payment: { id: string; amountOre: number }) => void;
  /** All amounts are paid: make the receipt. */
  onDone: () => void;
  onClose: () => void;
}

const POLL_MS = 1500;

/** Text for Swish's error codes that staff are likely to see. */
function failureText(t: ReturnType<typeof useT>, p: SwishPayment): string {
  if (p.status === 'declined') return t('The guest declined the payment in Swish.');
  if (p.status === 'cancelled') return t('The payment was cancelled.');
  if (p.errorCode === 'TM01') return t('The guest did not pay in time.');
  if (p.errorCode === 'BANKIDCL') return t('The guest cancelled BankID.');
  return t('Swish stopped the payment ({code}).', { code: p.errorCode ?? '?' });
}

/** Shows the guest a Swish QR code and waits for Swish to confirm, one amount at a time. */
export function SwishDialog({ amounts, onPaid, onDone, onClose }: Props) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [payment, setPayment] = useState<(SwishPayment & { qrSvg?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [stopping, setStopping] = useState(false);
  const live = useRef(true);
  const startedFor = useRef<string | null>(null);
  const amount = amounts[index]!;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Start a payment request for the current amount (again, after "Try again"). Once per
  // amount and round, even when React runs effects twice in development.
  useEffect(() => {
    const key = `${index}:${round}`;
    if (startedFor.current === key) return;
    startedFor.current = key;
    setPayment(null);
    setError(null);
    startSwishPayment(amount)
      .then((p) => live.current && setPayment(p))
      .catch(
        (err: unknown) =>
          live.current && setError(err instanceof Error ? err.message : String(err)),
      );
  }, [amount, index, round]);

  // Wait for Swish while the request is open.
  const pending = payment?.status === 'pending';
  const id = payment?.id;
  useEffect(() => {
    if (!pending || !id) return;
    const timer = setInterval(() => {
      getSwishPayment(id)
        .then(
          (p) => live.current && setPayment((cur) => (cur?.id === p.id ? { ...cur, ...p } : cur)),
        )
        .catch(() => {
          // A missed check is fine; the next one will try again.
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, id]);

  // Paid: report it and move on to the next amount, or finish.
  useEffect(() => {
    if (payment?.status !== 'paid') return;
    onPaid({ id: payment.id, amountOre: payment.amountOre });
    const next = setTimeout(() => {
      if (index + 1 < amounts.length) setIndex(index + 1);
      else onDone();
    }, 700);
    return () => clearTimeout(next);
    // Only when this payment becomes paid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.status, payment?.id]);

  async function stop() {
    if (!payment || payment.status !== 'pending') return onClose();
    setStopping(true);
    try {
      const p = await cancelSwishPayment(payment.id);
      // The guest paid just before we cancelled: keep the money, finish the sale.
      if (p.status === 'paid') setPayment((cur) => (cur ? { ...cur, ...p } : cur));
      else onClose();
    } catch {
      onClose();
    } finally {
      setStopping(false);
    }
  }

  const failed = payment && payment.status !== 'pending' && payment.status !== 'paid';

  return (
    <Modal
      opened
      onClose={stop}
      closeOnClickOutside={false}
      size="sm"
      centered
      title={
        <Group gap="sm">
          <Text fw={650} fz="lg">
            {t('Swish')}
          </Text>
          {amounts.length > 1 && (
            <Badge variant="light">
              {t('{n} of {count}', { n: index + 1, count: amounts.length })}
            </Badge>
          )}
        </Group>
      }
    >
      <Stack gap="md" align="center">
        <Text fz={34} fw={650} className="mono" lh={1}>
          {formatKr(amount)}
        </Text>

        <Box className="swish-qr" data-done={payment?.status === 'paid'}>
          {!payment && !error && (
            <Center h="100%">
              <Loader type="dots" />
            </Center>
          )}
          {payment?.qrSvg && payment.status === 'pending' && (
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(payment.qrSvg)}`}
              alt={t('Swish QR code')}
            />
          )}
          {payment?.status === 'paid' && (
            <Center h="100%">
              <Stack align="center" gap={6}>
                <IconCircleCheck size={64} stroke={1.4} color="var(--mantine-color-teal-6)" />
                <Text fw={600}>{t('Paid')}</Text>
              </Stack>
            </Center>
          )}
          {failed && (
            <Center h="100%">
              <IconAlertCircle size={56} stroke={1.4} color="var(--mantine-color-red-6)" />
            </Center>
          )}
        </Box>

        {pending && (
          <Group gap={8} c="dimmed">
            <Loader size="xs" />
            <Text fz="sm">{t('Ask the guest to scan the code with the Swish app.')}</Text>
          </Group>
        )}

        {(error || failed) && (
          <Alert color="red" variant="light" w="100%">
            {error ?? failureText(t, payment!)}
          </Alert>
        )}

        {pending && payment.simulated && (
          <Stack gap={6} w="100%" p="sm" className="summary-box">
            <Group gap={6}>
              <IconTestPipe size={14} />
              <Text fz="xs" c="dimmed">
                {t('Swish simulator: no real money. Pretend to be the guest:')}
              </Text>
            </Group>
            <Group grow>
              <Button
                size="xs"
                variant="light"
                color="teal"
                onClick={() => void simulateSwishPayment(payment.id, 'paid').then(setPaymentFrom)}
              >
                {t('Guest pays')}
              </Button>
              <Button
                size="xs"
                variant="light"
                color="red"
                onClick={() =>
                  void simulateSwishPayment(payment.id, 'declined').then(setPaymentFrom)
                }
              >
                {t('Guest declines')}
              </Button>
            </Group>
          </Stack>
        )}

        <Group grow w="100%">
          {(error || failed) && (
            <Button onClick={() => setRound((r) => r + 1)}>{t('Try again')}</Button>
          )}
          {payment?.status !== 'paid' && (
            <Button variant="default" loading={stopping} onClick={stop}>
              {pending ? t('Cancel payment') : t('Close')}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );

  function setPaymentFrom(p: SwishPayment) {
    if (live.current) setPayment((cur) => (cur?.id === p.id ? { ...cur, ...p } : cur));
  }
}
