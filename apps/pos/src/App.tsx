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
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconArmchair,
  IconCash,
  IconChefHat,
  IconChevronDown,
  IconCreditCard,
  IconDeviceMobile,
  IconFileAnalytics,
  IconLock,
  IconLogout,
  IconMinus,
  IconPercentage,
  IconPlus,
  IconReceipt,
  IconSchool,
  IconSearch,
  IconSend,
  IconShoppingBag,
  IconToolsKitchen2,
  IconUsersGroup,
  IconX,
} from '@tabler/icons-react';
import {
  buildReceipt,
  ore,
  roundToKrona,
  type BuiltReceipt,
  type PaymentMethod,
} from '@pos/domain';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  cancelOpenOrder,
  createOpenOrder,
  createReceipt,
  getHealth,
  getMenu,
  isManager,
  listUnusedSwishPayments,
  listOpenOrders,
  newAttemptKey,
  sendOpenOrder,
  updateOpenOrder,
  type Article,
  type DeviceInfo,
  type DiningTable,
  type Menu,
  type OpenOrder,
  type Receipt,
  type Staff,
} from './api';
import {
  addLine,
  fromOrderLine,
  lineGross,
  toBasketLine,
  toRequest,
  type BasketLine,
} from './basket';
import { Brand } from './Brand';
import { CashDialog } from './CashDialog';
import { formatKr } from './format';
import { ColorSchemeToggle, LanguageToggle, useT } from './i18n';
import { KitchenView } from './KitchenView';
import { LineDialog } from './LineDialog';
import { ROLE_LABELS } from './LoginScreen';
import { OptionsDialog } from './OptionsDialog';
import { OrderDiscountDialog } from './OrderDiscountDialog';
import { avatarColor, initials } from './people';
import { ReceiptsDialog } from './ReceiptsDialog';
import { ReceiptView } from './ReceiptView';
import { ReportDialog } from './ReportDialog';
import { SplitDialog } from './SplitDialog';
import { SwishDialog } from './SwishDialog';
import { TablesDialog } from './TablesDialog';

type Payment = { method: PaymentMethod; amountOre: number; swishPaymentId?: string };
type ChargeOptions = { subset?: BasketLine[]; changeOre?: number; busyKey: string };
type PaidSwish = { id: string; amountOre: number };

/** The table order on screen: saved on the server as it changes. */
interface ActiveOrder {
  id: string;
  version: number;
  tableId: string | null;
  tableName: string | null;
}

/** Each menu group gets its own accent, so staff find items by colour as well as name. */
const GROUP_ACCENTS = ['brand', 'indigo', 'orange', 'grape', 'cyan', 'pink', 'teal', 'violet'];
const accentOf = (groupIndex: number) =>
  `var(--mantine-color-${GROUP_ACCENTS[groupIndex % GROUP_ACCENTS.length]}-5)`;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Totals with the same logic the API uses. Null while the order is empty or invalid. */
function previewOf(lines: BasketLine[], orderDiscountOre: number): BuiltReceipt | null {
  if (lines.length === 0) return null;
  try {
    return buildReceipt({
      kind: 'proforma',
      lines: lines.map((l) => ({
        articleId: l.articleId,
        name: l.name,
        quantity: l.quantity,
        unitPriceOre: ore(l.unitPriceOre),
        vatRate: l.vatRate,
        discountOre: ore(Math.min(l.discountOre, lineGross(l))),
      })),
      ...(orderDiscountOre > 0 && { orderDiscountOre: ore(orderDiscountOre) }),
      payments: [],
    });
  } catch {
    return null;
  }
}

/** Part of the order for a split: the chosen quantities, with their share of line discounts. */
function subsetOf(lines: BasketLine[], quantities: Record<string, number>): BasketLine[] {
  return lines.flatMap((l) => {
    const n = quantities[l.key] ?? 0;
    if (n <= 0) return [];
    return [{ ...l, quantity: n, discountOre: Math.round((l.discountOre * n) / l.quantity) }];
  });
}

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
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [order, setOrder] = useState<ActiveOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [training, setTraining] = useState(trainingOnly);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ receipt: Receipt; changeOre: number } | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'cash' }
    | { kind: 'receipts' }
    | { kind: 'report'; type: 'x' | 'z' }
    | { kind: 'options'; article: Article }
    | { kind: 'line'; key: string }
    | { kind: 'discount' }
    | { kind: 'split' }
    | { kind: 'tables' }
    | { kind: 'swish'; payments: Payment[]; opts: ChargeOptions }
    | null
  >(null);
  const [kitchen, setKitchen] = useState(false);
  // Swish money the guest has paid that is not on a receipt yet, e.g. because making the
  // receipt failed. The next Swish charge for the same amount uses it instead of a new QR code.
  const paidSwish = useRef<PaidSwish[]>([]);
  const [unusedSwish, setUnusedSwish] = useState<PaidSwish[]>([]);
  const setPaidSwish = (list: PaidSwish[]) => {
    paidSwish.current = list;
    setUnusedSwish(list);
  };
  // Set when the basket was just loaded from the server, so that load isn't saved back.
  const fromServer = useRef(false);

  useEffect(() => {
    getMenu()
      .then((m) => {
        setMenu(m);
        // Swish money paid before a reload, not on a receipt yet: keep it usable.
        if (m.restaurant.swish) {
          listUnusedSwishPayments()
            .then((list) => setPaidSwish(list.map((p) => ({ id: p.id, amountOre: p.amountOre }))))
            .catch(() => {});
        }
      })
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

  // A table order is saved shortly after each change, so every till sees the same order.
  useEffect(() => {
    if (!order) return;
    if (fromServer.current) {
      fromServer.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setSaving(true);
      updateOpenOrder(order.id, {
        lines: toRequest(basket),
        orderDiscountOre: orderDiscount,
        version: order.version,
      })
        .then((saved) => {
          setOrder((o) => (o && o.id === saved.id ? { ...o, version: saved.version } : o));
          // Keep what the kitchen has already received in sync.
          setBasket((lines) =>
            lines.map((l) => ({
              ...l,
              sentQuantity: saved.lines.find((s) => s.key === l.key)?.sentQuantity ?? 0,
            })),
          );
          fromServer.current = true;
        })
        .catch(async (err: unknown) => {
          setError(message(err));
          await reloadOrder(order.id);
        })
        .finally(() => setSaving(false));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basket, orderDiscount]);

  const preview = useMemo(() => previewOf(basket, orderDiscount), [basket, orderDiscount]);

  function showOrder(o: OpenOrder) {
    fromServer.current = true;
    setOrder({ id: o.id, version: o.version, tableId: o.tableId, tableName: o.tableName });
    setBasket(o.lines.map(fromOrderLine));
    setOrderDiscount(o.orderDiscountOre);
  }

  function leaveOrder() {
    fromServer.current = true;
    setOrder(null);
    setBasket([]);
    setOrderDiscount(0);
  }

  async function reloadOrder(id: string) {
    const fresh = (await listOpenOrders().catch(() => [])).find((o) => o.id === id);
    if (fresh) showOrder(fresh);
    else leaveOrder();
  }

  function add(article: Article, optionIds: string[] = []) {
    setError(null);
    setBasket((lines) => addLine(lines, toBasketLine(article, optionIds)));
  }

  function tapItem(article: Article) {
    if (article.optionGroups.length > 0) setDialog({ kind: 'options', article });
    else add(article);
  }

  function changeQuantity(key: string, delta: number) {
    setBasket((lines) =>
      lines.flatMap((l) => {
        if (l.key !== key) return [l];
        const quantity = l.quantity + delta;
        if (quantity < Math.max(1, l.sentQuantity))
          return quantity <= 0 && l.sentQuantity === 0 ? [] : [l];
        return [
          { ...l, quantity, discountOre: Math.min(l.discountOre, quantity * l.unitPriceOre) },
        ];
      }),
    );
  }

  /** Opens a table: its existing order, or a new one that takes over what's on screen now. */
  async function openTable(table: DiningTable, existing: OpenOrder | null) {
    setDialog(null);
    setError(null);
    if (existing) {
      if (order?.id !== existing.id) showOrder(existing);
      return;
    }
    try {
      setBusy('table');
      const created = await createOpenOrder({
        tableId: table.id,
        lines: order ? [] : toRequest(basket),
        orderDiscountOre: order ? 0 : orderDiscount,
      });
      showOrder(created);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  /** Leaves the table order (it stays open on the table). An empty order is cancelled. */
  async function closeTable() {
    if (!order) return;
    if (basket.length === 0) await cancelOpenOrder(order.id).catch(() => {});
    leaveOrder();
  }

  async function sendToKitchen() {
    if (!order) return;
    setBusy('send');
    try {
      // Save first, so the kitchen gets exactly what's on screen.
      const saved = await updateOpenOrder(order.id, {
        lines: toRequest(basket),
        orderDiscountOre: orderDiscount,
        version: order.version,
      });
      const result = await sendOpenOrder(saved.id);
      showOrder(result.order);
      notifications.show({
        color: 'brand',
        icon: <IconChefHat size={18} />,
        message: t('Sent to the kitchen'),
        autoClose: 2000,
      });
    } catch (err) {
      setError(message(err));
      await reloadOrder(order.id);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Takes payment. Where the restaurant has Swish set up, Swish amounts are collected through a
   * QR code first, and the receipt is made only once Swish has confirmed them.
   */
  function pay(payments: Payment[], opts: ChargeOptions) {
    const needsSwish = (p: Payment) => p.method === 'swish' && !p.swishPaymentId;
    if (!menu?.restaurant.swish || training || !payments.some(needsSwish)) {
      return charge(payments, opts);
    }
    const pool = [...paidSwish.current];
    const filled = payments.map((p) => {
      if (!needsSwish(p)) return p;
      const i = pool.findIndex((x) => x.amountOre === p.amountOre);
      if (i < 0) return p;
      const [match] = pool.splice(i, 1);
      return { ...p, swishPaymentId: match!.id };
    });
    if (!filled.some(needsSwish)) return charge(filled, opts);
    setError(null);
    setDialog({ kind: 'swish', payments: filled, opts });
  }

  /** Makes the receipt. `subset` pays only part of the order (split by items). */
  async function charge(payments: Payment[], opts: ChargeOptions) {
    setBusy(opts.busyKey);
    setError(null);
    const lines = opts.subset ?? basket;
    const body = {
      kind: training ? ('training' as const) : ('sale' as const),
      lines: toRequest(lines),
      ...(!opts.subset && orderDiscount > 0 && { orderDiscountOre: orderDiscount }),
      payments,
      ...(order && { openOrderId: order.id }),
    };
    // Tapping pay again for the same order after a lost connection reuses the key, so the
    // API returns the receipt it already made instead of charging twice.
    const signature = JSON.stringify(body);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: newAttemptKey() };
    }
    try {
      if (order) {
        // The server takes the paid lines off the saved order, so save pending changes first.
        const saved = await updateOpenOrder(order.id, {
          lines: toRequest(basket),
          orderDiscountOre: orderDiscount,
          version: order.version,
        });
        setOrder((o) => (o ? { ...o, version: saved.version } : o));
      }
      const receipt = await createReceipt(body, attempt.current.key);
      attempt.current = null;
      const used = new Set(payments.map((p) => p.swishPaymentId));
      setPaidSwish(paidSwish.current.filter((p) => !used.has(p.id)));
      setDialog(null);
      setDone({ receipt, changeOre: opts.changeOre ?? 0 });
      if (order) await reloadOrder(order.id);
      else if (opts.subset) {
        const paid = new Map(opts.subset.map((l) => [l.key, l]));
        fromServer.current = true;
        setBasket((all) =>
          all.flatMap((l) => {
            const p = paid.get(l.key);
            if (!p) return [l];
            const quantity = l.quantity - p.quantity;
            return quantity > 0
              ? [{ ...l, quantity, discountOre: l.discountOre - p.discountOre }]
              : [];
          }),
        );
      } else {
        fromServer.current = true;
        setBasket([]);
        setOrderDiscount(0);
      }
    } catch (err) {
      setDialog(null);
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  if (kitchen) return <KitchenView onExit={() => setKitchen(false)} />;

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
  const lineDiscounts = basket.reduce((s, l) => s + Math.min(l.discountOre, lineGross(l)), 0);
  const itemCount = basket.reduce((n, l) => n + l.quantity, 0);
  const canPay = basket.length > 0 && busy === null && online !== false && preview !== null;
  const inOrder = new Map<string, number>();
  for (const l of basket) inOrder.set(l.articleId, (inOrder.get(l.articleId) ?? 0) + l.quantity);
  const unsent = basket.reduce((n, l) => n + (l.station ? l.quantity - l.sentQuantity : 0), 0);
  const menuEmpty = menu.groups.every((g) => g.articles.length === 0);
  const editing = dialog?.kind === 'line' ? basket.find((l) => l.key === dialog.key) : undefined;

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
            {menu.tables.length > 0 && (
              <Button
                variant={order?.tableId ? 'light' : 'default'}
                leftSection={<IconArmchair size={17} stroke={1.7} />}
                onClick={() => setDialog({ kind: 'tables' })}
              >
                {order?.tableName ?? t('Tables')}
              </Button>
            )}
            <Button.Group>
              <Button
                variant="default"
                leftSection={<IconReceipt size={17} stroke={1.7} />}
                onClick={() => setDialog({ kind: 'receipts' })}
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
                  <DropdownMenu.Item onClick={() => setDialog({ kind: 'report', type: 'x' })}>
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
                    onClick={() => setDialog({ kind: 'report', type: 'z' })}
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
                visibleFrom="md"
              >
                {t('Training')}
              </Button>
            </Tooltip>

            <Divider orientation="vertical" my={18} />
            <LanguageToggle />
            <ColorSchemeToggle />

            <DropdownMenu position="bottom-end" width={230}>
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
                  leftSection={<IconChefHat size={16} />}
                  onClick={() => setKitchen(true)}
                >
                  {t('Kitchen display')}
                </DropdownMenu.Item>
                <DropdownMenu.Divider />
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
                      onClick={() => tapItem(a)}
                    >
                      {inOrder.has(a.id) && <span className="item-qty">{inOrder.get(a.id)}</span>}
                      <Text fw={600} lh={1.3} lineClamp={2} pr={inOrder.has(a.id) ? 28 : 0}>
                        {a.name}
                      </Text>
                      <Group justify="space-between" align="center" wrap="nowrap">
                        <span className="item-price">
                          {a.optionGroups.length > 0 && (
                            <span className="item-from">{t('from')} </span>
                          )}
                          {formatKr(a.priceOre)}
                        </span>
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
                <Group gap={8}>
                  <Title order={4} fw={600}>
                    {order?.tableName ?? t('Current order')}
                  </Title>
                  {order && saving && <Loader size={12} type="oval" />}
                </Group>
                <Text fz="xs" c="dimmed">
                  {itemCount === 0
                    ? t('Empty')
                    : itemCount === 1
                      ? t('1 item')
                      : t('{count} items', { count: itemCount })}
                </Text>
              </div>
              <Group gap={4} wrap="nowrap">
                <Tooltip label={t('Discount on the order')}>
                  <ActionIcon
                    variant={orderDiscount > 0 ? 'light' : 'subtle'}
                    color={orderDiscount > 0 ? 'brand' : 'gray'}
                    size="lg"
                    disabled={basket.length === 0}
                    onClick={() => setDialog({ kind: 'discount' })}
                    aria-label={t('Discount on the order')}
                  >
                    <IconPercentage size={18} />
                  </ActionIcon>
                </Tooltip>
                {order ? (
                  <Button variant="subtle" color="gray" size="compact-sm" onClick={closeTable}>
                    {t('Close table')}
                  </Button>
                ) : (
                  basket.length > 0 && (
                    <Button
                      variant="subtle"
                      color="red"
                      size="compact-sm"
                      onClick={() => {
                        setBasket([]);
                        setOrderDiscount(0);
                      }}
                      disabled={busy !== null}
                    >
                      {t('Clear')}
                    </Button>
                  )
                )}
              </Group>
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
                      key={l.key}
                      className="order-line"
                      justify="space-between"
                      wrap="nowrap"
                      gap="sm"
                    >
                      <UnstyledButton
                        style={{ minWidth: 0, flex: 1 }}
                        onClick={() => setDialog({ kind: 'line', key: l.key })}
                      >
                        <Group gap={6} wrap="nowrap">
                          <Text fw={550} truncate>
                            {l.name}
                          </Text>
                          {l.sentQuantity > 0 && (
                            <Tooltip
                              label={t('{count} sent to the kitchen', { count: l.sentQuantity })}
                            >
                              <IconChefHat size={14} color="var(--mantine-color-brand-filled)" />
                            </Tooltip>
                          )}
                        </Group>
                        {l.options && (
                          <Text fz="xs" c="dimmed" truncate>
                            {l.options}
                          </Text>
                        )}
                        <Text fz="xs" c={l.discountOre > 0 ? 'brand' : 'dimmed'} className="mono">
                          {formatKr(l.unitPriceOre)}
                          {l.discountOre > 0 && ` · −${formatKr(l.discountOre)}`}
                        </Text>
                      </UnstyledButton>
                      <Group gap={0} className="qty-pill" wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          radius="xl"
                          size={34}
                          disabled={l.quantity <= l.sentQuantity}
                          aria-label={t('Remove one {name}', { name: l.name })}
                          onClick={() => changeQuantity(l.key, -1)}
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
                          aria-label={t('Add one {name}', { name: l.name })}
                          onClick={() => changeQuantity(l.key, 1)}
                        >
                          <IconPlus size={15} />
                        </ActionIcon>
                      </Group>
                      <Text w={88} ta="right" fw={600} className="mono" fz="sm">
                        {formatKr(lineGross(l) - Math.min(l.discountOre, lineGross(l)))}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </ScrollArea>

            <Stack gap={12} p="lg" className="checkout">
              <Stack gap={4}>
                {(lineDiscounts > 0 || orderDiscount > 0) && (
                  <Group justify="space-between">
                    <Text fz="sm" c="brand">
                      {t('Discounts')}
                    </Text>
                    <Text fz="sm" c="brand" className="mono">
                      −{formatKr(lineDiscounts + orderDiscount)}
                    </Text>
                  </Group>
                )}
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
                <Alert
                  color="red"
                  variant="light"
                  icon={<IconAlertCircle size={18} />}
                  py="xs"
                  withCloseButton
                  onClose={() => setError(null)}
                >
                  {t(error)}
                </Alert>
              )}
              {unusedSwish.length > 0 && dialog === null && (
                <Alert color="orange" variant="light" py="xs" icon={<IconDeviceMobile size={18} />}>
                  {t(
                    'Swish has paid {amount} that is not on a receipt yet. Charge Swish for the same amount to use it.',
                    {
                      amount: unusedSwish.map((p) => formatKr(p.amountOre)).join(', '),
                    },
                  )}
                </Alert>
              )}
              {online === false && (
                <Alert color="red" variant="light" py="xs">
                  {t('The control system is not responding. No receipt was created.')}
                </Alert>
              )}

              {order && unsent > 0 && (
                <Button
                  variant="light"
                  size="md"
                  h={48}
                  leftSection={<IconSend size={18} />}
                  loading={busy === 'send'}
                  disabled={busy !== null && busy !== 'send'}
                  onClick={sendToKitchen}
                >
                  {t('Send to kitchen ({count})', { count: unsent })}
                </Button>
              )}

              <Button
                className="charge-button"
                size="xl"
                h={64}
                fullWidth
                loading={busy === 'card'}
                disabled={!canPay}
                leftSection={<IconCreditCard size={24} stroke={1.7} />}
                onClick={() => pay([{ method: 'card', amountOre: total }], { busyKey: 'card' })}
              >
                {basket.length === 0
                  ? t('Card')
                  : t('Charge {amount}', { amount: formatKr(total) })}
              </Button>
              <SimpleGrid cols={3} spacing={10}>
                <Button
                  variant="default"
                  size="md"
                  h={52}
                  loading={busy === 'swish'}
                  disabled={!canPay}
                  leftSection={<IconDeviceMobile size={19} stroke={1.7} />}
                  onClick={() => pay([{ method: 'swish', amountOre: total }], { busyKey: 'swish' })}
                >
                  {t('Swish')}
                </Button>
                <Button
                  variant="default"
                  size="md"
                  h={52}
                  disabled={!canPay}
                  leftSection={<IconCash size={19} stroke={1.7} />}
                  onClick={() => setDialog({ kind: 'cash' })}
                >
                  {t('Cash')}
                </Button>
                <Button
                  variant="default"
                  size="md"
                  h={52}
                  disabled={!canPay}
                  leftSection={<IconUsersGroup size={19} stroke={1.7} />}
                  onClick={() => setDialog({ kind: 'split' })}
                >
                  {t('Split')}
                </Button>
              </SimpleGrid>
            </Stack>
          </Box>
        </Box>
      </AppShell.Main>

      {dialog?.kind === 'receipts' && (
        <ReceiptsDialog
          canReturn={manager}
          onClose={() => setDialog(null)}
          onDone={(receipt) => {
            setDialog(null);
            setDone({ receipt, changeOre: 0 });
          }}
        />
      )}
      {dialog?.kind === 'report' && (
        <ReportDialog type={dialog.type} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'cash' && (
        <CashDialog
          totalOre={total}
          busy={busy === 'cash'}
          onPay={(amountOre, changeOre) =>
            pay([{ method: 'cash', amountOre }], { changeOre, busyKey: 'cash' })
          }
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'options' && (
        <OptionsDialog
          article={dialog.article}
          onClose={() => setDialog(null)}
          onAdd={(optionIds) => {
            add(dialog.article, optionIds);
            setDialog(null);
          }}
        />
      )}
      {editing && (
        <LineDialog
          line={editing}
          onClose={() => setDialog(null)}
          onRemove={() => {
            setBasket((lines) => lines.filter((l) => l.key !== editing.key));
            setDialog(null);
          }}
          onSave={(line) => {
            setBasket((lines) => lines.map((l) => (l.key === line.key ? line : l)));
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'discount' && (
        <OrderDiscountDialog
          amountOre={basket.reduce(
            (s, l) => s + lineGross(l) - Math.min(l.discountOre, lineGross(l)),
            0,
          )}
          currentOre={orderDiscount}
          onClose={() => setDialog(null)}
          onSave={(d) => {
            setOrderDiscount(d);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'split' && (
        <SplitDialog
          lines={basket}
          totalOre={total}
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onPayParts={(payments) => pay(payments, { busyKey: 'split' })}
          onPayItems={(quantities, method) => {
            const subset = subsetOf(basket, quantities);
            const subtotal = previewOf(subset, 0)?.totalOre ?? 0;
            const amountOre = method === 'cash' ? roundToKrona(ore(subtotal)) : subtotal;
            void pay([{ method, amountOre }], { subset, busyKey: 'split' });
          }}
        />
      )}
      {dialog?.kind === 'swish' && (
        <SwishDialog
          amounts={dialog.payments
            .filter((p) => p.method === 'swish' && !p.swishPaymentId)
            .map((p) => p.amountOre)}
          onPaid={(p) => setPaidSwish([...paidSwish.current, p])}
          onDone={() => void pay(dialog.payments, dialog.opts)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'tables' && (
        <TablesDialog
          tables={menu.tables}
          currentTableId={order?.tableId ?? null}
          onOpen={openTable}
          onClose={() => setDialog(null)}
        />
      )}
      {done && (
        <ReceiptView
          receipt={done.receipt}
          restaurantName={menu.restaurant.name}
          changeOre={done.changeOre}
          onNewSale={() => setDone(null)}
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
