import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  Group,
  Menu,
  Modal,
  RingProgress,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBuildingStore,
  IconCheck,
  IconCopy,
  IconDeviceTablet,
  IconDots,
  IconLink,
  IconMapPin,
  IconPlus,
  IconPower,
  IconUnlink,
} from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Register } from '../api';
import { useConfirm } from '../confirm';
import { formatDateTime, formatOrgNumber, STATUS_LABELS } from '../format';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { PageHeader } from '../PageHeader';
import { useAction, useLoad } from '../useLoad';
import { TableSkeleton } from './TableSkeleton';

const STATUS_COLORS = { pending: 'orange', active: 'brand', suspended: 'red' } as const;

/** Branches (restaurants) and their registers. Registers are retired, never deleted. */
export function RestaurantsPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const { data, error, reload } = useLoad(() => api.restaurants(tenantId), [tenantId]);
  const action = useAction({ toast: true });
  const [addingRestaurant, setAddingRestaurant] = useState(false);
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
    designation: string;
  } | null>(null);

  async function retire(register: Register) {
    const ok = await confirm({
      title: t('Retire {name}?', { name: register.designation }),
      message: t('It can no longer sell. Its receipts and Z reports are kept.'),
      confirmLabel: t('Retire'),
      danger: true,
    });
    if (ok && (await action.run(() => api.retireRegister(tenantId, register.id)))) {
      notifyOk(t('{name} is retired.', { name: register.designation }));
      reload();
    }
  }

  async function showCode(register: Register) {
    await action.run(async () => {
      const { code, expiresAt } = await api.pairingCode(tenantId, register.id);
      setPairing({ code, expiresAt, designation: register.designation });
    });
  }

  async function revoke(deviceId: string, name: string) {
    const ok = await confirm({
      title: t('Unpair {name}?', { name }),
      message: t('Anyone logged in on it is logged out at once.'),
      confirmLabel: t('Unpair'),
      danger: true,
    });
    if (ok && (await action.run(() => api.revokeDevice(tenantId, deviceId)))) {
      notifyOk(t('{name} is unpaired.', { name }));
      reload();
    }
  }

  return (
    <>
      <PageHeader
        title={t('Restaurants & registers')}
        description={
          data?.company && (
            <Group gap={8} component="span">
              <span>
                {data.company.legalName} · {formatOrgNumber(data.company.orgNumber)}
              </span>
              <Badge
                size="sm"
                variant="light"
                radius="sm"
                color={STATUS_COLORS[data.company.status]}
              >
                {t(STATUS_LABELS[data.company.status])}
              </Badge>
            </Group>
          )
        }
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setAddingRestaurant(true)}>
            {t('New restaurant')}
          </Button>
        }
      />

      {data?.company.status === 'pending' && (
        <Alert color="orange" variant="light" mb="lg" icon={<IconAlertCircle size={18} />}>
          {t(
            'The company is waiting for approval. You can set everything up now; the registers can sell once the company is approved.',
          )}
        </Alert>
      )}
      {error && <Text c="red">{t(error)}</Text>}
      {!data && !error && (
        <Card withBorder radius="lg" padding={0}>
          <TableSkeleton />
        </Card>
      )}

      <Stack gap="lg">
        {data?.restaurants.map((r) => (
          <Card key={r.id} withBorder radius="lg" padding={0}>
            <Group justify="space-between" p="lg" pb="md">
              <Group gap="sm">
                <ThemeIcon variant="light" size={40} radius="md">
                  <IconBuildingStore size={22} stroke={1.6} />
                </ThemeIcon>
                <div>
                  <Text fw={650} fz="lg">
                    {r.name}
                  </Text>
                  {r.address && (
                    <Group gap={4} c="dimmed">
                      <IconMapPin size={13} />
                      <Text fz="xs">{r.address}</Text>
                    </Group>
                  )}
                </div>
              </Group>
              <Badge variant="default" radius="sm">
                {t('{count} registers', {
                  count: r.registers.filter((c) => c.status === 'active').length,
                })}
              </Badge>
            </Group>

            {r.registers.length > 0 && (
              <Table.ScrollContainer minWidth={720}>
                <Table verticalSpacing="sm" horizontalSpacing="lg">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('Register (designation)')}</Table.Th>
                      <Table.Th>{t('Status')}</Table.Th>
                      <Table.Th>{t('Paired devices')}</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {r.registers.map((c) => (
                      <Table.Tr key={c.id} opacity={c.status === 'retired' ? 0.55 : 1}>
                        <Table.Td>
                          <Text fw={600} className="mono" fz="sm">
                            {c.designation}
                          </Text>
                          <Text fz="xs" c="dimmed">
                            {t('Created {date}', { date: formatDateTime(c.createdAt) })}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6}>
                            {c.status === 'active' ? (
                              <Badge variant="light" radius="sm">
                                {t('Active')}
                              </Badge>
                            ) : (
                              <Badge variant="light" color="gray" radius="sm">
                                {t('Retired {date}', {
                                  date: c.retiredAt ? formatDateTime(c.retiredAt) : '',
                                })}
                              </Badge>
                            )}
                            <Tooltip label={t('Control system')}>
                              <Badge
                                variant="dot"
                                color={c.enrolled ? 'brand' : 'gray'}
                                radius="sm"
                              >
                                {c.enrolled ? t('Connected') : t('Not connected')}
                              </Badge>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {c.devices.length === 0 ? (
                            <Text fz="sm" c="dimmed">
                              {t('None')}
                            </Text>
                          ) : (
                            <Stack gap={4}>
                              {c.devices.map((d) => (
                                <Group key={d.id} gap={8} wrap="nowrap">
                                  <IconDeviceTablet size={16} stroke={1.6} />
                                  <div style={{ minWidth: 0 }}>
                                    <Text fz="sm" fw={500} truncate>
                                      {d.name}
                                    </Text>
                                    <Text fz="xs" c="dimmed">
                                      {d.lastSeenAt
                                        ? t('last used {date}', {
                                            date: formatDateTime(d.lastSeenAt),
                                          })
                                        : t('paired {date}', { date: formatDateTime(d.pairedAt) })}
                                    </Text>
                                  </div>
                                  <Tooltip label={t('Unpair')}>
                                    <ActionIcon
                                      variant="subtle"
                                      color="red"
                                      size="sm"
                                      onClick={() => revoke(d.id, d.name)}
                                      aria-label={t('Unpair')}
                                    >
                                      <IconUnlink size={14} />
                                    </ActionIcon>
                                  </Tooltip>
                                </Group>
                              ))}
                            </Stack>
                          )}
                        </Table.Td>
                        <Table.Td ta="right">
                          {c.status === 'active' && (
                            <Group gap={6} justify="flex-end" wrap="nowrap">
                              <Button
                                size="xs"
                                variant="light"
                                leftSection={<IconLink size={14} />}
                                onClick={() => showCode(c)}
                              >
                                {t('Pair device')}
                              </Button>
                              <Menu position="bottom-end" shadow="md">
                                <Menu.Target>
                                  <ActionIcon variant="subtle" color="gray" aria-label={t('More')}>
                                    <IconDots size={16} />
                                  </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                  <Menu.Item
                                    color="red"
                                    leftSection={<IconPower size={16} />}
                                    onClick={() => retire(c)}
                                  >
                                    {t('Retire')}
                                  </Menu.Item>
                                </Menu.Dropdown>
                              </Menu>
                            </Group>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}

            <AddRegisterForm
              tenantId={tenantId}
              restaurantId={r.id}
              empty={r.registers.length === 0}
              onAdded={reload}
            />
          </Card>
        ))}
      </Stack>

      <AddRestaurantDialog
        opened={addingRestaurant}
        tenantId={tenantId}
        onClose={() => setAddingRestaurant(false)}
        onAdded={() => {
          setAddingRestaurant(false);
          reload();
        }}
      />
      {pairing && (
        <PairingCodeDialog
          {...pairing}
          onClose={() => {
            setPairing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function AddRegisterForm({
  tenantId,
  restaurantId,
  empty,
  onAdded,
}: {
  tenantId: string;
  restaurantId: string;
  empty: boolean;
  onAdded: () => void;
}) {
  const t = useT();
  const [designation, setDesignation] = useState('');
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = designation.trim();
    if (!name) return;
    if (await run(() => api.addRegister(tenantId, restaurantId, name))) {
      notifyOk(
        t('{name} is added and connected to the control system.', { name: name.toUpperCase() }),
      );
      setDesignation('');
      onAdded();
    }
  }

  return (
    <form onSubmit={submit}>
      <Group p="md" px="lg" gap="sm" align="flex-start" className="card-footer">
        {empty && (
          <Text fz="sm" c="dimmed" w="100%">
            {t('No register yet.')} {t('Add one to start selling here.')}
          </Text>
        )}
        <TextInput
          placeholder={t('New register, e.g. TILL-2')}
          pattern="[A-Za-z0-9\-]{1,20}"
          title={t('Letters, digits and dashes, at most 20 characters')}
          value={designation}
          onChange={(e) => setDesignation(e.currentTarget.value)}
          error={error ? t(error) : undefined}
          style={{ flex: 1, maxWidth: 320 }}
        />
        <Button type="submit" variant="default" leftSection={<IconPlus size={16} />} loading={busy}>
          {t('Add register')}
        </Button>
      </Group>
    </form>
  );
}

function AddRestaurantDialog({
  opened,
  tenantId,
  onClose,
  onAdded,
}: {
  opened: boolean;
  tenantId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api.addRestaurant(tenantId, { name, ...(address && { address }) }));
    if (ok) {
      notifyOk(t('{name} is added.', { name }));
      setName('');
      setAddress('');
      onAdded();
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={650}>{t('New restaurant')}</Text>}>
      <form onSubmit={submit}>
        <Stack gap="md">
          <TextInput
            label={t('Name')}
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label={t('Address (optional)')}
            value={address}
            onChange={(e) => setAddress(e.currentTarget.value)}
          />
          {error && (
            <Text c="red" fz="sm">
              {t(error)}
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" loading={busy}>
              {t('Add')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** The one-time code to type on the till, with a countdown until it expires. */
function PairingCodeDialog({
  code,
  expiresAt,
  designation,
  onClose,
}: {
  code: string;
  expiresAt: string;
  designation: string;
  onClose: () => void;
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const total = 15 * 60;
  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <Modal
      opened
      onClose={onClose}
      size="md"
      title={<Text fw={650}>{t('Pair a device with {name}', { name: designation })}</Text>}
    >
      <Stack align="center" gap="md" ta="center">
        <Text fz="sm" c="dimmed">
          {t(
            'Open the till on the tablet or computer and type in the code. The code can be used once.',
          )}
        </Text>
        <Group gap="xs">
          <Text
            className="pairing-code"
            c={left > 0 ? undefined : 'dimmed'}
            td={left > 0 ? undefined : 'line-through'}
          >
            {code}
          </Text>
          {left > 0 && (
            <CopyButton value={code}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? t('Copied') : t('Copy')}>
                  <ActionIcon variant="subtle" color={copied ? 'brand' : 'gray'} onClick={copy}>
                    {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          )}
        </Group>
        <RingProgress
          size={88}
          thickness={6}
          roundCaps
          sections={[{ value: (left / total) * 100, color: left > 60 ? 'brand' : 'orange' }]}
          label={
            <Text ta="center" fz="sm" fw={600} className="tabular">
              {mmss}
            </Text>
          }
        />
        <Text fz="sm" c={left > 0 ? 'dimmed' : 'red'}>
          {left > 0
            ? t('Valid for {time}', { time: mmss })
            : t('The code has expired. Close and create a new one.')}
        </Text>
        <Button fullWidth onClick={onClose}>
          {t('Done')}
        </Button>
      </Stack>
    </Modal>
  );
}
