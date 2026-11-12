import {
  ActionIcon,
  Alert,
  AppShell,
  Avatar,
  Badge,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Menu as DropdownMenu,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCash,
  IconChevronDown,
  IconCreditCard,
  IconDeviceMobile,
  IconFileAnalytics,
  IconLock,
  IconLogout,
  IconMinus,
  IconPlus,
  IconReceipt,
  IconSchool,
  IconShoppingBagX,
  IconToolsKitchen2,
  IconTrash,
} from '@tabler/icons-react';
import { buildReceipt, ore, type PaymentMethod } from '@pos/domain';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createReceipt,
  getHealth,
  getMenu,
  isManager,
  newAttemptKey,
  type Article,
  type DeviceInfo,
  type Menu,
  type Receipt,
  type Staff,
} from './api';
import { Brand } from './Brand';
import { CashDialog } from './CashDialog';
import { formatKr } from './format';
import { ColorSchemeToggle, LanguageToggle, useT } from './i18n';
import { ROLE_LABELS } from './LoginScreen';
import { avatarColor, initials } from './people';
import { ReceiptsDialog } from './ReceiptsDialog';
import { ReceiptView } from './ReceiptView';
import { ReportDialog } from './ReportDialog';

interface BasketLine {
  article: Article;
  quantity: number;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Props {
  staff: Staff;
  device: DeviceInfo;
  onLogout: () => void;
}

export function App({ staff, device, onLogout }: Props) {
  const t = useT();
  const manager = isManager(staff);
  // Until the company is approved the till can only train.
  const trainingOnly = device.company.status === 'pending';
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [training, setTraining] = useState(trainingOnly);
  const [cashOpen, setCashOpen] = useState(false);
  const [busy, setBusy] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ receipt: Receipt; changeOre: number } | null>(null);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [report, setReport] = useState<'x' | 'z' | null>(null);

  useEffect(() => {
    getMenu()
      .then(setMenu)
      .catch((err: unknown) => setLoadError(message(err)));
  }, []);

  useEffect(() => {
    const check = () =>
      getHealth()
        .then((h) => setOnline(h.controlSystem.online))
        .catch(() => setOnline(false));
    void check();
    const timer = setInterval(check, 10_000);
    return () => clearInterval(timer);
  }, []);

  // Live totals with the same domain logic the API uses; the API recomputes from its own prices.
  const preview = useMemo(
    () =>
      basket.length === 0
        ? null
        : buildReceipt({
            kind: 'proforma',
            lines: basket.map((l) => ({
              articleId: l.article.id,
              name: l.article.name,
              quantity: l.quantity,
              unitPriceOre: ore(l.article.priceOre),
              vatRate: l.article.vatRate,
            })),
            payments: [],
          }),
    [basket],
  );

  function add(article: Article) {
    setError(null);
    setBasket((lines) =>
      lines.some((l) => l.article.id === article.id)
        ? lines.map((l) => (l.article.id === article.id ? { ...l, quantity: l.quantity + 1 } : l))
        : [...lines, { article, quantity: 1 }],
    );
  }

  function changeQuantity(articleId: string, delta: number) {
    setBasket((lines) =>
      lines.flatMap((l) => {
        if (l.article.id !== articleId) return [l];
        const quantity = l.quantity + delta;
        return quantity > 0 ? [{ ...l, quantity }] : [];
      }),
    );
  }

  async function pay(method: PaymentMethod, amountOre: number, changeOre = 0) {
    setBusy(method);
    setError(null);
    const body = {
      kind: training ? ('training' as const) : ('sale' as const),
      lines: basket.map((l) => ({ articleId: l.article.id, quantity: l.quantity })),
      payments: [{ method, amountOre }],
    };
    // Tapping pay again for the same order after a lost connection reuses the key, so the
    // API returns the receipt it already made instead of charging twice.
    const signature = JSON.stringify(body);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: newAttemptKey() };
    }
    try {
      const receipt = await createReceipt(body, attempt.current.key);
      attempt.current = null;
      setCashOpen(false);
      setDone({ receipt, changeOre });
    } catch (err) {
      setCashOpen(false);
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  function newSale() {
    // Copies and returns are made from the receipts dialog and leave an open order alone.
    if (done?.receipt.kind === 'sale' || done?.receipt.kind === 'training') setBasket([]);
    setDone(null);
  }

  if (loadError) {
    return (
      <Center h="100%" p="md">
        <Stack align="center" gap="xs" maw={460} ta="center">
          <IconAlertCircle size={40} stroke={1.4} color="var(--mantine-color-red-6)" />
          <Title order={3}>{t('The till could not start')}</Title>
          <Text c="dimmed">{t(loadError)}</Text>
        </Stack>
      </Center>
    );
  }
  if (!menu) {
    return (
      <Center h="100%">
        <Loader type="dots" />
      </Center>
    );
  }

  const group = menu.groups[groupIndex];
  const total = preview?.totalOre ?? 0;
  const itemCount = basket.reduce((n, l) => n + l.quantity, 0);
  const canPay = basket.length > 0 && busy === null && online !== false;
  const inOrder = new Map(basket.map((l) => [l.article.id, l.quantity]));

  return (
    <AppShell header={{ height: 64 }} padding={0}>
      <AppShell.Header px="md" className="till-header">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            <Brand compact />
            <div>
              <Text fw={650} lh={1.2}>
                {menu.restaurant.name}
              </Text>
              <Text fz="xs" c="dimmed">
                {t('Register {name}', { name: menu.register.designation })}
              </Text>
            </div>
            <StatusPill online={online} />
          </Group>

          <Group gap="xs" wrap="nowrap">
            <Button
              variant="default"
              leftSection={<IconReceipt size={18} stroke={1.6} />}
              onClick={() => setReceiptsOpen(true)}
            >
              {t('Receipts')}
            </Button>
            <DropdownMenu position="bottom-end" width={220} shadow="md">
              <DropdownMenu.Target>
                <Button
                  variant="default"
                  leftSection={<IconFileAnalytics size={18} stroke={1.6} />}
                  rightSection={<IconChevronDown size={14} />}
                >
                  {t('Reports')}
                </Button>
              </DropdownMenu.Target>
              <DropdownMenu.Dropdown>
                <DropdownMenu.Item onClick={() => setReport('x')}>
                  {t('X report')}
                  <Text fz="xs" c="dimmed">
                    {t('Sales so far today')}
                  </Text>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  disabled={!manager}
                  rightSection={!manager && <IconLock size={14} />}
                  onClick={() => setReport('z')}
                >
                  {t('Z report')}
                  <Text fz="xs" c="dimmed">
                    {manager ? t('Close the day') : t('Managers and owners only')}
                  </Text>
                </DropdownMenu.Item>
              </DropdownMenu.Dropdown>
            </DropdownMenu>

            <Tooltip
              label={
                trainingOnly
                  ? t('Training only until the company is approved')
                  : t('Practice without real sales')
              }
            >
              <div>
                <Switch
                  color="orange"
                  size="md"
                  label={t('Training')}
                  thumbIcon={<IconSchool size={12} />}
                  checked={training}
                  disabled={basket.length > 0 || trainingOnly}
                  onChange={(e) => setTraining(e.currentTarget.checked)}
                  visibleFrom="md"
                />
              </div>
            </Tooltip>

            <Divider orientation="vertical" mx={4} />
            <LanguageToggle />
            <ColorSchemeToggle />

            <DropdownMenu position="bottom-end" width={220} shadow="md">
              <DropdownMenu.Target>
                <UnstyledButton aria-label={staff.displayName}>
                  <Group gap={8} wrap="nowrap">
                    <Avatar
                      radius="xl"
                      size={36}
                      color={avatarColor(staff.displayName)}
                      variant="light"
                    >
                      {initials(staff.displayName)}
                    </Avatar>
                    <Box visibleFrom="lg">
                      <Text fz="sm" fw={600} lh={1.2}>
                        {staff.displayName}
                      </Text>
                      <Text fz="xs" c="dimmed">
                        {t(ROLE_LABELS[staff.role])}
                      </Text>
                    </Box>
                  </Group>
                </UnstyledButton>
              </DropdownMenu.Target>
              <DropdownMenu.Dropdown>
                <DropdownMenu.Label>{device.device.name}</DropdownMenu.Label>
                <DropdownMenu.Item
                  leftSection={<IconLogout size={16} />}
                  disabled={busy !== null}
                  onClick={onLogout}
                >
                  {t('Log out')}
                </DropdownMenu.Item>
              </DropdownMenu.Dropdown>
            </DropdownMenu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        {training && (
          <Group
            justify="center"
            gap={8}
            py={6}
            bg="orange.6"
            c="white"
            fz="sm"
            fw={600}
            style={{ letterSpacing: '0.04em' }}
          >
            <IconSchool size={16} />
            {t('TRAINING MODE – sales are not real')}
          </Group>
        )}

        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) clamp(320px, 32vw, 420px)',
            height: `calc(100dvh - 64px${training ? ' - 33px' : ''})`,
          }}
        >
          {/* Menu */}
          <Stack gap={0} style={{ minHeight: 0 }}>
            <ScrollArea type="never" px="md" pt="md" pb="xs" style={{ flex: 'none' }}>
              <Group gap="xs" wrap="nowrap">
                {menu.groups.map((g, i) => (
                  <Button
                    key={g.name ?? ''}
                    radius="xl"
                    variant={i === groupIndex ? 'filled' : 'default'}
                    onClick={() => setGroupIndex(i)}
                    style={{ flex: 'none' }}
                  >
                    {g.name ?? t('Other')}
                    <Badge
                      ml={8}
                      size="sm"
                      circle
                      variant={i === groupIndex ? 'white' : 'light'}
                      color={i === groupIndex ? 'dark' : 'gray'}
                    >
                      {g.articles.length}
                    </Badge>
                  </Button>
                ))}
              </Group>
            </ScrollArea>

            <ScrollArea style={{ flex: 1 }} px="md" pb="md">
              {menu.groups.length === 0 ? (
                <Center h={300}>
                  <Stack align="center" gap={6}>
                    <IconToolsKitchen2 size={36} stroke={1.3} color="var(--mantine-color-gray-5)" />
                    <Text c="dimmed">{t('The menu is empty.')}</Text>
                  </Stack>
                </Center>
              ) : (
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 4, xl: 5 }} spacing="sm" pt={4}>
                  {group?.articles.map((a) => (
                    <UnstyledButton
                      key={a.id}
                      className="item-card"
                      data-in-order={inOrder.has(a.id)}
                      onClick={() => add(a)}
                    >
                      <Group justify="space-between" align="flex-start" wrap="nowrap" gap={6}>
                        <Text fw={600} lh={1.3} lineClamp={2}>
                          {a.name}
                        </Text>
                        {inOrder.has(a.id) && (
                          <Badge size="lg" circle variant="filled">
                            {inOrder.get(a.id)}
                          </Badge>
                        )}
                      </Group>
                      <Text className="item-price">{formatKr(a.priceOre)}</Text>
                    </UnstyledButton>
                  ))}
                </SimpleGrid>
              )}
            </ScrollArea>
          </Stack>

          {/* Order */}
          <Box
            className="order-panel"
            style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
          >
            <Group justify="space-between" px="lg" pt="lg" pb="sm">
              <Group gap={8}>
                <Title order={4}>{t('Order')}</Title>
                {itemCount > 0 && (
                  <Badge variant="light" radius="sm">
                    {itemCount}
                  </Badge>
                )}
              </Group>
              {basket.length > 0 && (
                <Tooltip label={t('Clear order')}>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => setBasket([])}
                    disabled={busy !== null}
                    aria-label={t('Clear order')}
                  >
                    <IconTrash size={18} stroke={1.6} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>

            <ScrollArea style={{ flex: 1 }} px="lg">
              {basket.length === 0 ? (
                <Stack align="center" justify="center" gap={6} h={220} c="dimmed">
                  <IconShoppingBagX size={36} stroke={1.3} />
                  <Text fz="sm">{t('Tap an item to add it.')}</Text>
                </Stack>
              ) : (
                <Stack gap={0}>
                  {basket.map((l) => (
                    <Group
                      key={l.article.id}
                      justify="space-between"
                      wrap="nowrap"
                      py="sm"
                      style={{ borderBottom: '1px solid var(--till-line)' }}
                    >
                      <Box style={{ minWidth: 0 }}>
                        <Text fw={550} truncate>
                          {l.article.name}
                        </Text>
                        <Text fz="xs" c="dimmed" className="tabular">
                          {formatKr(l.article.priceOre)}
                        </Text>
                      </Box>
                      <Group gap={6} wrap="nowrap">
                        <ActionIcon
                          variant="default"
                          radius="xl"
                          size="lg"
                          aria-label={t('Remove one {name}', { name: l.article.name })}
                          onClick={() => changeQuantity(l.article.id, -1)}
                        >
                          <IconMinus size={16} />
                        </ActionIcon>
                        <Text w={24} ta="center" fw={600} className="tabular">
                          {l.quantity}
                        </Text>
                        <ActionIcon
                          variant="default"
                          radius="xl"
                          size="lg"
                          aria-label={t('Add one {name}', { name: l.article.name })}
                          onClick={() => changeQuantity(l.article.id, 1)}
                        >
                          <IconPlus size={16} />
                        </ActionIcon>
                        <Text w={84} ta="right" fw={600} className="tabular">
                          {formatKr(l.quantity * l.article.priceOre)}
                        </Text>
                      </Group>
                    </Group>
                  ))}
                </Stack>
              )}
            </ScrollArea>

            <Stack gap="sm" p="lg" style={{ borderTop: '1px solid var(--till-line)' }}>
              {preview?.vatTotals.map((v) => (
                <Group key={v.vatRate} justify="space-between">
                  <Text fz="sm" c="dimmed">
                    {t('incl. VAT {rate}%', { rate: v.vatRate })}
                  </Text>
                  <Text fz="sm" c="dimmed" className="tabular">
                    {formatKr(v.vatOre)}
                  </Text>
                </Group>
              ))}
              <Group justify="space-between" align="baseline">
                <Text fw={600}>{t('Total')}</Text>
                <Text className="total-figure">{formatKr(total)}</Text>
              </Group>

              {error && (
                <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} py="xs">
                  {t(error)}
                </Alert>
              )}
              {online === false && (
                <Alert color="red" variant="light" py="xs">
                  {t('The control system is not responding. No receipt was created.')}
                </Alert>
              )}

              <SimpleGrid cols={3} spacing="xs">
                <PayButton
                  icon={<IconCreditCard size={26} stroke={1.6} />}
                  label={t('Card')}
                  loading={busy === 'card'}
                  disabled={!canPay}
                  onClick={() => pay('card', total)}
                />
                <PayButton
                  icon={<IconDeviceMobile size={26} stroke={1.6} />}
                  label={t('Swish')}
                  loading={busy === 'swish'}
                  disabled={!canPay}
                  onClick={() => pay('swish', total)}
                />
                <PayButton
                  icon={<IconCash size={26} stroke={1.6} />}
                  label={t('Cash')}
                  loading={busy === 'cash'}
                  disabled={!canPay}
                  onClick={() => setCashOpen(true)}
                />
              </SimpleGrid>
            </Stack>
          </Box>
        </Box>
      </AppShell.Main>

      {receiptsOpen && (
        <ReceiptsDialog
          canReturn={manager}
          onClose={() => setReceiptsOpen(false)}
          onDone={(receipt) => {
            setReceiptsOpen(false);
            setDone({ receipt, changeOre: 0 });
          }}
        />
      )}
      {report && <ReportDialog type={report} onClose={() => setReport(null)} />}
      {cashOpen && (
        <CashDialog
          totalOre={total}
          busy={busy === 'cash'}
          onPay={(amountOre, changeOre) => pay('cash', amountOre, changeOre)}
          onCancel={() => setCashOpen(false)}
        />
      )}
      {done && (
        <ReceiptView
          receipt={done.receipt}
          restaurantName={menu.restaurant.name}
          changeOre={done.changeOre}
          onNewSale={newSale}
        />
      )}
    </AppShell>
  );
}

function PayButton(props: {
  icon: ReactNode;
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      h={76}
      size="md"
      loading={props.loading}
      disabled={props.disabled}
      onClick={props.onClick}
      styles={{ label: { flexDirection: 'column', gap: 4 } }}
    >
      {props.icon}
      {props.label}
    </Button>
  );
}

function StatusPill({ online }: { online: boolean | null }) {
  const t = useT();
  const color = online === null ? 'gray' : online ? 'brand' : 'red';
  const label =
    online === null
      ? t('Connecting…')
      : online
        ? t('Control system online')
        : t('Control system offline');
  return (
    <Tooltip label={label}>
      <Badge
        variant="light"
        color={color}
        radius="sm"
        visibleFrom="sm"
        leftSection={
          <Box
            w={8}
            h={8}
            style={{ borderRadius: '50%', background: `var(--mantine-color-${color}-6)` }}
          />
        }
        styles={{ section: { marginRight: 8 } }}
      >
        {online === null ? t('Connecting…') : online ? t('Online') : t('Offline')}
      </Badge>
    </Tooltip>
  );
}
