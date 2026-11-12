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
  Text,
  TextInput,
  ThemeIcon,
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
  IconSearch,
  IconShoppingBag,
  IconToolsKitchen2,
  IconX,
} from '@tabler/icons-react';
import { buildReceipt, ore, type PaymentMethod } from '@pos/domain';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

/** Each menu group gets its own accent, so staff find items by colour as well as name. */
const GROUP_ACCENTS = ['brand', 'indigo', 'orange', 'grape', 'cyan', 'pink', 'teal', 'violet'];
const accentOf = (groupIndex: number) =>
  `var(--mantine-color-${GROUP_ACCENTS[groupIndex % GROUP_ACCENTS.length]}-5)`;

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
  const [search, setSearch] = useState('');
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

  const query = search.trim().toLowerCase();
  const visible = query
    ? menu.groups.flatMap((g, gi) =>
        g.articles.filter((a) => a.name.toLowerCase().includes(query)).map((a) => ({ a, gi })),
      )
    : (menu.groups[groupIndex]?.articles ?? []).map((a) => ({ a, gi: groupIndex }));
  const total = preview?.totalOre ?? 0;
  const vatTotal = preview?.vatTotals.reduce((s, v) => s + v.vatOre, 0) ?? 0;
  const itemCount = basket.reduce((n, l) => n + l.quantity, 0);
  const canPay = basket.length > 0 && busy === null && online !== false;
  const inOrder = new Map(basket.map((l) => [l.article.id, l.quantity]));
  const menuEmpty = menu.groups.every((g) => g.articles.length === 0);

  return (
    <AppShell header={{ height: 68 }} padding={0}>
      <AppShell.Header px="lg" className="till-header">
        <Group h="100%" justify="space-between" wrap="nowrap" gap="md">
          <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
            <Brand compact />
            <Box style={{ minWidth: 0 }}>
              <Text fw={600} lh={1.25} truncate>
                {menu.restaurant.name}
              </Text>
              <Group gap={6} wrap="nowrap">
                <Text fz="xs" c="dimmed" className="mono">
                  {menu.register.designation}
                </Text>
                <StatusDot online={online} />
              </Group>
            </Box>
          </Group>

          <Group gap={10} wrap="nowrap">
            <Button.Group>
              <Button
                variant="default"
                leftSection={<IconReceipt size={17} stroke={1.7} />}
                onClick={() => setReceiptsOpen(true)}
              >
                {t('Receipts')}
              </Button>
              <DropdownMenu position="bottom-end" width={240}>
                <DropdownMenu.Target>
                  <Button
                    variant="default"
                    leftSection={<IconFileAnalytics size={17} stroke={1.7} />}
                    rightSection={<IconChevronDown size={14} />}
                  >
                    {t('Reports')}
                  </Button>
                </DropdownMenu.Target>
                <DropdownMenu.Dropdown>
                  <DropdownMenu.Item onClick={() => setReport('x')}>
                    <Text fz="sm" fw={500}>
                      {t('X report')}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {t('Sales so far today')}
                    </Text>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={!manager}
                    rightSection={!manager && <IconLock size={14} />}
                    onClick={() => setReport('z')}
                  >
                    <Text fz="sm" fw={500}>
                      {t('Z report')}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {manager ? t('Close the day') : t('Managers and owners only')}
                    </Text>
                  </DropdownMenu.Item>
                </DropdownMenu.Dropdown>
              </DropdownMenu>
            </Button.Group>

            <Tooltip
              label={
                trainingOnly
                  ? t('Training only until the company is approved')
                  : t('Practice without real sales')
              }
            >
              <Button
                variant={training ? 'light' : 'subtle'}
                color={training ? 'orange' : 'gray'}
                leftSection={<IconSchool size={17} stroke={1.7} />}
                disabled={basket.length > 0 || trainingOnly}
                onClick={() => setTraining((v) => !v)}
                className={training ? 'training-toggle-on' : undefined}
                visibleFrom="md"
              >
                {t('Training')}
              </Button>
            </Tooltip>

            <Divider orientation="vertical" my={18} />
            <LanguageToggle />
            <ColorSchemeToggle />

            <DropdownMenu position="bottom-end" width={220}>
              <DropdownMenu.Target>
                <UnstyledButton aria-label={staff.displayName} className="user-chip">
                  <Group gap={10} wrap="nowrap">
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
                      <Text fz="xs" c="dimmed" lh={1.2}>
                        {t(ROLE_LABELS[staff.role])}
                      </Text>
                    </Box>
                    <IconChevronDown size={14} color="var(--mantine-color-dimmed)" />
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
          <Group className="training-bar" justify="center" gap={8}>
            <IconSchool size={15} stroke={1.8} />
            <Text fz="xs" fw={650} lts={0.4}>
              {t('TRAINING MODE – sales are not real')}
            </Text>
          </Group>
        )}

        <Box
          className="till-layout"
          style={{ height: `calc(100dvh - 68px${training ? ' - 30px' : ''})` }}
        >
          {/* Menu */}
          <Stack gap={0} style={{ minHeight: 0 }}>
            <Group gap="sm" px="lg" pt="lg" pb="sm" wrap="nowrap">
              <TextInput
                radius="xl"
                placeholder={t('Search items')}
                leftSection={<IconSearch size={16} />}
                rightSection={
                  search && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      radius="xl"
                      size="sm"
                      onClick={() => setSearch('')}
                      aria-label={t('Clear')}
                    >
                      <IconX size={14} />
                    </ActionIcon>
                  )
                }
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                w={260}
                style={{ flex: 'none' }}
              />
              {!query && (
                <ScrollArea type="never" style={{ flex: 1 }}>
                  <Group gap={8} wrap="nowrap">
                    {menu.groups.map((g, i) => (
                      <UnstyledButton
                        key={g.name ?? ''}
                        className="category-chip"
                        data-active={i === groupIndex}
                        style={{ '--accent': accentOf(i) } as CSSProperties}
                        onClick={() => setGroupIndex(i)}
                      >
                        <span className="category-dot" />
                        {g.name ?? t('Other')}
                        <span className="category-count">{g.articles.length}</span>
                      </UnstyledButton>
                    ))}
                  </Group>
                </ScrollArea>
              )}
            </Group>

            <ScrollArea style={{ flex: 1 }} px="lg" pb="lg">
              {menuEmpty ? (
                <EmptyState
                  icon={<IconToolsKitchen2 size={28} stroke={1.5} />}
                  title={t('No items yet')}
                  text={t(
                    'Add groups and items under Menu in the back office. They appear here at once.',
                  )}
                />
              ) : visible.length === 0 ? (
                <EmptyState
                  icon={<IconSearch size={26} stroke={1.5} />}
                  title={t('No items match “{query}”', { query: search.trim() })}
                  text={t('Check the spelling or clear the search.')}
                />
              ) : (
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 4, xl: 5 }} spacing="md" pt={6}>
                  {visible.map(({ a, gi }) => (
                    <UnstyledButton
                      key={a.id}
                      className="item-card"
                      data-in-order={inOrder.has(a.id)}
                      style={{ '--accent': accentOf(gi) } as CSSProperties}
                      onClick={() => add(a)}
                    >
                      {inOrder.has(a.id) && <span className="item-qty">{inOrder.get(a.id)}</span>}
                      <Text fw={600} lh={1.3} lineClamp={2} pr={inOrder.has(a.id) ? 28 : 0}>
                        {a.name}
                      </Text>
                      <Group justify="space-between" align="center" wrap="nowrap">
                        <span className="item-price">{formatKr(a.priceOre)}</span>
                        <span className="item-add" aria-hidden="true">
                          <IconPlus size={14} stroke={2.2} />
                        </span>
                      </Group>
                    </UnstyledButton>
                  ))}
                </SimpleGrid>
              )}
            </ScrollArea>
          </Stack>

          {/* Order */}
          <Box className="order-panel">
            <Group justify="space-between" px="lg" pt="lg" pb="md" wrap="nowrap">
              <div>
                <Title order={4} fw={600}>
                  {t('Current order')}
                </Title>
                <Text fz="xs" c="dimmed">
                  {itemCount === 0
                    ? t('Empty')
                    : itemCount === 1
                      ? t('1 item')
                      : t('{count} items', { count: itemCount })}
                </Text>
              </div>
              {basket.length > 0 && (
                <Button
                  variant="subtle"
                  color="red"
                  size="compact-sm"
                  onClick={() => setBasket([])}
                  disabled={busy !== null}
                >
                  {t('Clear')}
                </Button>
              )}
            </Group>

            <ScrollArea style={{ flex: 1 }} px="lg">
              {basket.length === 0 ? (
                <Stack align="center" justify="center" gap={10} h={260} ta="center">
                  <ThemeIcon size={56} radius="xl" color="gray" variant="light">
                    <IconShoppingBag size={26} stroke={1.5} />
                  </ThemeIcon>
                  <Text fw={600}>{t('No items yet')}</Text>
                  <Text fz="sm" c="dimmed" maw={220}>
                    {t('Tap items on the left to start an order.')}
                  </Text>
                </Stack>
              ) : (
                <Stack gap={0}>
                  {basket.map((l) => (
                    <Group
                      key={l.article.id}
                      className="order-line"
                      justify="space-between"
                      wrap="nowrap"
                      gap="sm"
                    >
                      <Box style={{ minWidth: 0, flex: 1 }}>
                        <Text fw={550} truncate>
                          {l.article.name}
                        </Text>
                        <Text fz="xs" c="dimmed" className="mono">
                          {formatKr(l.article.priceOre)}
                        </Text>
                      </Box>
                      <Group gap={0} className="qty-pill" wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          radius="xl"
                          size={34}
                          aria-label={t('Remove one {name}', { name: l.article.name })}
                          onClick={() => changeQuantity(l.article.id, -1)}
                        >
                          <IconMinus size={15} />
                        </ActionIcon>
                        <Text w={26} ta="center" fw={600} className="tabular">
                          {l.quantity}
                        </Text>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          radius="xl"
                          size={34}
                          aria-label={t('Add one {name}', { name: l.article.name })}
                          onClick={() => changeQuantity(l.article.id, 1)}
                        >
                          <IconPlus size={15} />
                        </ActionIcon>
                      </Group>
                      <Text w={88} ta="right" fw={600} className="mono" fz="sm">
                        {formatKr(l.quantity * l.article.priceOre)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </ScrollArea>

            <Stack gap={12} p="lg" className="checkout">
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text fz="sm" c="dimmed">
                    {t('Subtotal excl. VAT')}
                  </Text>
                  <Text fz="sm" c="dimmed" className="mono">
                    {formatKr(total - vatTotal)}
                  </Text>
                </Group>
                {preview?.vatTotals.map((v) => (
                  <Group key={v.vatRate} justify="space-between">
                    <Text fz="sm" c="dimmed">
                      {t('VAT {rate}%', { rate: v.vatRate })}
                    </Text>
                    <Text fz="sm" c="dimmed" className="mono">
                      {formatKr(v.vatOre)}
                    </Text>
                  </Group>
                ))}
              </Stack>
              <Divider color="var(--app-line)" />
              <Group justify="space-between" align="flex-end">
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

              <Button
                className="charge-button"
                size="xl"
                h={64}
                fullWidth
                loading={busy === 'card'}
                disabled={!canPay}
                leftSection={<IconCreditCard size={24} stroke={1.7} />}
                onClick={() => pay('card', total)}
              >
                {basket.length === 0
                  ? t('Card')
                  : t('Charge {amount}', { amount: formatKr(total) })}
              </Button>
              <SimpleGrid cols={2} spacing={10}>
                <Button
                  variant="default"
                  size="lg"
                  h={54}
                  loading={busy === 'swish'}
                  disabled={!canPay}
                  leftSection={<IconDeviceMobile size={20} stroke={1.7} />}
                  onClick={() => pay('swish', total)}
                >
                  {t('Swish')}
                </Button>
                <Button
                  variant="default"
                  size="lg"
                  h={54}
                  loading={busy === 'cash'}
                  disabled={!canPay}
                  leftSection={<IconCash size={20} stroke={1.7} />}
                  onClick={() => setCashOpen(true)}
                >
                  {t('Cash')}
                </Button>
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

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Center h={360}>
      <Stack align="center" gap={10} maw={340} ta="center">
        <ThemeIcon size={64} radius="xl" color="gray" variant="light" className="empty-icon">
          {icon}
        </ThemeIcon>
        <Text fw={600} fz="lg">
          {title}
        </Text>
        <Text fz="sm" c="dimmed">
          {text}
        </Text>
      </Stack>
    </Center>
  );
}

function StatusDot({ online }: { online: boolean | null }) {
  const t = useT();
  const state = online === null ? 'pending' : online ? 'online' : 'offline';
  const label =
    online === null
      ? t('Connecting…')
      : online
        ? t('Control system online')
        : t('Control system offline');
  return (
    <Tooltip label={label}>
      <Badge
        size="sm"
        variant="light"
        color={online === null ? 'gray' : online ? 'brand' : 'red'}
        leftSection={<span className="status-dot" data-state={state} />}
      >
        {online === null ? t('Connecting…') : online ? t('Online') : t('Offline')}
      </Badge>
    </Tooltip>
  );
}
