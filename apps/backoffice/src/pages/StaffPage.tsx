import {
  Avatar,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconDeviceDesktop, IconKey, IconLock, IconUserPlus } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { api, type Role, type StaffMember } from '../api';
import { FormError } from '../AuthPages';
import { ROLE_LABELS } from '../format';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { PageHeader } from '../PageHeader';
import { avatarColor, initials } from '../people';
import { useAction, useLoad } from '../useLoad';
import { TableSkeleton } from './TableSkeleton';

interface Props {
  tenantId: string;
  myRole: Role;
  myUserId: string;
}

/** Staff and roles. Everyone gets a till PIN; owners and managers can also get a back office login. */
export function StaffPage({ tenantId, myRole, myUserId }: Props) {
  const t = useT();
  const { data, error, reload } = useLoad(() => api.staff(tenantId), [tenantId]);
  const action = useAction({ toast: true });
  const [adding, setAdding] = useState(false);
  const [pinFor, setPinFor] = useState<StaffMember | null>(null);
  const assignable: Role[] =
    myRole === 'owner' ? ['cashier', 'manager', 'owner'] : ['cashier', 'manager'];

  const update = async (
    userId: string,
    body: Parameters<typeof api.updateStaff>[2],
    done: string,
  ) => {
    if (await action.run(() => api.updateStaff(tenantId, userId, body))) {
      notifyOk(done);
      reload();
    }
  };

  const active = data?.filter((s) => s.active).length ?? 0;

  return (
    <>
      <PageHeader
        title={t('Staff')}
        description={data ? t('{count} active staff', { count: active }) : undefined}
        actions={
          <Button leftSection={<IconUserPlus size={16} />} onClick={() => setAdding(true)}>
            {t('Add staff')}
          </Button>
        }
      />
      {error && <Text c="red">{t(error)}</Text>}
      <Card withBorder radius="lg" padding={0}>
        {!data && !error && <TableSkeleton />}
        {data && (
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="sm" horizontalSpacing="lg" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('Name')}</Table.Th>
                  <Table.Th w={170}>{t('Role')}</Table.Th>
                  <Table.Th>{t('Login')}</Table.Th>
                  <Table.Th w={90} ta="center">
                    {t('Active')}
                  </Table.Th>
                  <Table.Th w={120} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((s) => {
                  const self = s.userId === myUserId;
                  const locked = s.role === 'owner' && myRole !== 'owner';
                  return (
                    <Table.Tr key={s.userId} opacity={s.active ? 1 : 0.5}>
                      <Table.Td>
                        <Group gap="sm" wrap="nowrap">
                          <Avatar radius="xl" color={avatarColor(s.displayName)} variant="light">
                            {initials(s.displayName)}
                          </Avatar>
                          <div>
                            <Text fw={600} fz="sm">
                              {s.displayName}
                              {self && (
                                <Text span c="dimmed" fw={400}>
                                  {' '}
                                  {t('(you)')}
                                </Text>
                              )}
                            </Text>
                            {s.email && (
                              <Text fz="xs" c="dimmed">
                                {s.email}
                              </Text>
                            )}
                          </div>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          allowDeselect={false}
                          value={s.role}
                          disabled={self || locked}
                          onChange={(r) =>
                            r &&
                            update(
                              s.userId,
                              { role: r as Role },
                              t('Role changed for {name}.', { name: s.displayName }),
                            )
                          }
                          data={(locked ? (['owner'] as Role[]) : assignable).map((r) => ({
                            value: r,
                            label: t(ROLE_LABELS[r]),
                          }))}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6}>
                          {s.hasPin ? (
                            <Badge variant="light" radius="sm" leftSection={<IconKey size={12} />}>
                              {t('Till PIN')}
                            </Badge>
                          ) : (
                            <Badge variant="default" radius="sm">
                              {t('No PIN')}
                            </Badge>
                          )}
                          {s.hasPassword && (
                            <Badge
                              variant="light"
                              color="indigo"
                              radius="sm"
                              leftSection={<IconDeviceDesktop size={12} />}
                            >
                              {t('Back office')}
                            </Badge>
                          )}
                          {s.pinLocked && (
                            <Badge
                              variant="light"
                              color="red"
                              radius="sm"
                              leftSection={<IconLock size={12} />}
                            >
                              {t('Locked')}
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td ta="center">
                        <Tooltip
                          label={t('You cannot deactivate yourself or change your own role.')}
                          disabled={!self}
                        >
                          <Switch
                            display="inline-block"
                            aria-label={t('Active')}
                            checked={s.active}
                            disabled={self || locked}
                            onChange={(e) =>
                              update(
                                s.userId,
                                { active: e.currentTarget.checked },
                                e.currentTarget.checked
                                  ? t('{name} is active.', { name: s.displayName })
                                  : t('{name} is deactivated and logged out.', {
                                      name: s.displayName,
                                    }),
                              )
                            }
                          />
                        </Tooltip>
                      </Table.Td>
                      <Table.Td ta="right">
                        {!locked && (
                          <Button size="xs" variant="default" onClick={() => setPinFor(s)}>
                            {s.hasPin ? t('New PIN') : t('Set PIN')}
                          </Button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <AddStaffDialog
        opened={adding}
        assignable={assignable}
        tenantId={tenantId}
        onClose={() => setAdding(false)}
        onAdded={(name) => {
          setAdding(false);
          notifyOk(t('{name} is added.', { name }));
          reload();
        }}
      />
      <PinDialog
        member={pinFor}
        onClose={() => setPinFor(null)}
        onSave={async (pin) => {
          if (!pinFor) return;
          await update(
            pinFor.userId,
            { pin },
            t('New PIN saved for {name}.', { name: pinFor.displayName }),
          );
          setPinFor(null);
        }}
      />
    </>
  );
}

function PinDialog({
  member,
  onClose,
  onSave,
}: {
  member: StaffMember | null;
  onClose: () => void;
  onSave: (pin: string) => Promise<void>;
}) {
  const t = useT();
  const [pin, setPin] = useState('');
  const valid = /^\d{4,8}$/.test(pin);

  return (
    <Modal
      opened={member !== null}
      onClose={() => {
        setPin('');
        onClose();
      }}
      size="sm"
      title={<Text fw={650}>{t('New PIN for {name}', { name: member?.displayName ?? '' })}</Text>}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          await onSave(pin);
          setPin('');
        }}
      >
        <Stack gap="md">
          <PasswordInput
            label={t('Till PIN')}
            description={t('4–8 digits. A new PIN also unlocks a locked PIN.')}
            inputMode="numeric"
            autoFocus
            value={pin}
            error={pin && !valid ? t('The PIN must be 4–8 digits.') : undefined}
            onChange={(e) => setPin(e.currentTarget.value.replace(/\D/g, '').slice(0, 8))}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!valid}>
              {t('Save')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function AddStaffDialog({
  opened,
  assignable,
  tenantId,
  onClose,
  onAdded,
}: {
  opened: boolean;
  assignable: Role[];
  tenantId: string;
  onClose: () => void;
  onAdded: (name: string) => void;
}) {
  const t = useT();
  const empty = { displayName: '', role: 'cashier' as Role, pin: '', email: '', password: '' };
  const [form, setForm] = useState(empty);
  const { busy, error, run } = useAction();
  const backOffice = form.role !== 'cashier';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() =>
      api.addStaff(tenantId, {
        displayName: form.displayName,
        role: form.role,
        pin: form.pin,
        ...(form.email && { email: form.email }),
        ...(backOffice && form.password && { password: form.password }),
      }),
    );
    if (ok) {
      onAdded(form.displayName);
      setForm(empty);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={<Text fw={650}>{t('Add staff')}</Text>}
    >
      <form onSubmit={submit}>
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput
              label={t('Name')}
              required
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.currentTarget.value })}
            />
            <Select
              label={t('Role')}
              allowDeselect={false}
              value={form.role}
              onChange={(r) => r && setForm({ ...form, role: r as Role })}
              data={assignable.map((r) => ({ value: r, label: t(ROLE_LABELS[r]) }))}
            />
            <PasswordInput
              label={t('Till PIN')}
              description={t('4–8 digits')}
              required
              inputMode="numeric"
              value={form.pin}
              onChange={(e) =>
                setForm({ ...form, pin: e.currentTarget.value.replace(/\D/g, '').slice(0, 8) })
              }
            />
            <TextInput
              label={backOffice ? t('Email (for the back office)') : t('Email (optional)')}
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
            />
          </SimpleGrid>
          {backOffice && (
            <PasswordInput
              label={t('Back office password (optional, at least 10 characters)')}
              minLength={10}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
            />
          )}
          <FormError error={error} />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" loading={busy} disabled={!/^\d{4,8}$/.test(form.pin)}>
              {t('Add staff')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
