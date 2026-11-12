import {
  Alert,
  Anchor,
  AppShell,
  Avatar,
  Box,
  Burger,
  Button,
  Group,
  Menu,
  Modal,
  NavLink,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBuildingStore,
  IconChevronDown,
  IconFileAnalytics,
  IconHistory,
  IconLayoutDashboard,
  IconLogout,
  IconMailExclamation,
  IconPlus,
  IconShieldLock,
  IconToolsKitchen2,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Me } from './api';
import { FormError } from './AuthPages';
import { Brand } from './Brand';
import { formatOrgNumber, ROLE_LABELS } from './format';
import { ColorSchemeToggle, LanguageToggle, useT } from './i18n';
import { isOrgNumberOk, OrgNumberInput } from './OrgNumberInput';
import { notifyOk } from './notify';
import { AuditPage } from './pages/AuditPage';
import { MenuPage } from './pages/MenuPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlatformPage } from './pages/PlatformPage';
import { RestaurantsPage } from './pages/RestaurantsPage';
import { StaffPage } from './pages/StaffPage';
import { ZReportsPage } from './pages/ZReportsPage';
import { avatarColor, initials } from './people';
import { useAction } from './useLoad';

const COMPANY_PAGES = {
  restaurants: 'Restaurants & registers',
  menu: 'Menu',
  staff: 'Staff',
  z: 'Z reports',
  audit: 'Change log',
} as const;

const PAGE_ICONS: Record<keyof typeof COMPANY_PAGES, Icon> = {
  restaurants: IconBuildingStore,
  menu: IconToolsKitchen2,
  staff: IconUsers,
  z: IconFileAnalytics,
  audit: IconHistory,
};

type Page = 'overview' | 'platform' | keyof typeof COMPANY_PAGES;

const COMPANY_KEY = 'backoffice.company';

function pageFromHash(): Page {
  const hash = window.location.hash.replace('#/', '');
  return (['overview', 'platform', ...Object.keys(COMPANY_PAGES)] as string[]).includes(hash)
    ? (hash as Page)
    : 'overview';
}

interface Props {
  me: Me;
  onChanged: () => Promise<void>;
  onLogout: () => void;
}

export function Shell({ me, onChanged, onLogout }: Props) {
  const t = useT();
  const [navOpen, nav] = useDisclosure(false);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [tenantId, setTenantId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(COMPANY_KEY);
      if (saved && me.companies.some((c) => c.tenantId === saved)) return saved;
    } catch {
      // ignore
    }
    return me.companies[0]?.tenantId ?? null;
  });
  const [addingCompany, setAddingCompany] = useState(false);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function selectCompany(id: string) {
    setTenantId(id);
    try {
      localStorage.setItem(COMPANY_KEY, id);
    } catch {
      // ignore
    }
  }

  const company = me.companies.find((c) => c.tenantId === tenantId) ?? null;
  const go = (p: Page) => {
    window.location.hash = `#/${p}`;
    setPage(p);
    nav.close();
  };

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 272, breakpoint: 'sm', collapsed: { mobile: !navOpen } }}
      padding={{ base: 'md', sm: 'xl' }}
    >
      <AppShell.Header px="md" className="app-header">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={navOpen} onClick={nav.toggle} hiddenFrom="sm" size="sm" />
            <Brand sub={t('Back office')} />
          </Group>
          <Group gap="xs" wrap="nowrap">
            <LanguageToggle />
            <ColorSchemeToggle />
            <UserMenu me={me} onLogout={onLogout} />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" className="app-navbar">
        <AppShell.Section grow component={ScrollArea}>
          <Stack gap={4}>
            <NavLink
              label={t('Overview')}
              leftSection={<IconLayoutDashboard size={18} stroke={1.6} />}
              active={page === 'overview'}
              onClick={() => go('overview')}
            />

            {me.companies.length > 0 && (
              <Box mt="md" mb={4} px={6}>
                <Select
                  label={t('Company')}
                  size="sm"
                  allowDeselect={false}
                  checkIconPosition="right"
                  value={tenantId}
                  onChange={(id) => id && selectCompany(id)}
                  data={me.companies.map((c) => ({ value: c.tenantId, label: c.legalName }))}
                  comboboxProps={{ shadow: 'md' }}
                />
                {company && (
                  <Text fz="xs" c="dimmed" mt={6}>
                    {formatOrgNumber(company.orgNumber)} · {t(ROLE_LABELS[company.role])}
                  </Text>
                )}
              </Box>
            )}

            {company &&
              (Object.keys(COMPANY_PAGES) as (keyof typeof COMPANY_PAGES)[]).map((p) => {
                const PageIcon = PAGE_ICONS[p];
                return (
                  <NavLink
                    key={p}
                    label={t(COMPANY_PAGES[p])}
                    leftSection={<PageIcon size={18} stroke={1.6} />}
                    active={page === p}
                    onClick={() => go(p)}
                  />
                );
              })}

            <NavLink
              label={t('Register another company')}
              leftSection={<IconPlus size={18} stroke={1.6} />}
              c="dimmed"
              onClick={() => setAddingCompany(true)}
            />

            {me.isPlatformAdmin && (
              <>
                <Text className="eyebrow nav-section">{t('Platform')}</Text>
                <NavLink
                  label={t('Companies')}
                  leftSection={<IconShieldLock size={18} stroke={1.6} />}
                  active={page === 'platform'}
                  onClick={() => go('platform')}
                />
              </>
            )}
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box maw={1200} mx="auto">
          {!me.user.emailVerified && me.user.email && <VerifyBanner email={me.user.email} />}
          {page === 'overview' && <OverviewPage onRegister={() => setAddingCompany(true)} />}
          {page === 'platform' && me.isPlatformAdmin && <PlatformPage />}
          {company && page === 'restaurants' && <RestaurantsPage tenantId={company.tenantId} />}
          {company && page === 'menu' && <MenuPage tenantId={company.tenantId} />}
          {company && page === 'staff' && (
            <StaffPage
              tenantId={company.tenantId}
              myRole={company.role}
              myUserId={me.user.userId}
            />
          )}
          {company && page === 'z' && <ZReportsPage tenantId={company.tenantId} />}
          {company && page === 'audit' && <AuditPage tenantId={company.tenantId} />}
          {!company && page !== 'overview' && page !== 'platform' && (
            <Text c="dimmed">{t('You do not manage any company yet.')}</Text>
          )}
        </Box>
      </AppShell.Main>

      <AddCompanyDialog
        opened={addingCompany}
        onClose={() => setAddingCompany(false)}
        onAdded={async (id) => {
          setAddingCompany(false);
          await onChanged();
          selectCompany(id);
          go('restaurants');
        }}
      />
    </AppShell>
  );
}

function UserMenu({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const t = useT();
  return (
    <Menu position="bottom-end" width={240} shadow="md">
      <Menu.Target>
        <UnstyledButton aria-label={me.user.displayName}>
          <Group gap={8} wrap="nowrap">
            <Avatar radius="xl" size={34} color={avatarColor(me.user.displayName)} variant="light">
              {initials(me.user.displayName)}
            </Avatar>
            <Box visibleFrom="md">
              <Text fz="sm" fw={600} lh={1.2}>
                {me.user.displayName}
              </Text>
              <Text fz="xs" c="dimmed" lh={1.2}>
                {me.isPlatformAdmin ? t('Platform admin') : me.user.email}
              </Text>
            </Box>
            <IconChevronDown size={14} />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{me.user.email}</Menu.Label>
        <Menu.Item leftSection={<IconLogout size={16} />} onClick={onLogout}>
          {t('Log out')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function AddCompanyDialog({
  opened,
  onClose,
  onAdded,
}: {
  opened: boolean;
  onClose: () => void;
  onAdded: (tenantId: string) => Promise<void>;
}) {
  const t = useT();
  const [form, setForm] = useState({ legalName: '', orgNumber: '', restaurantName: '' });
  const { busy, error, run } = useAction();
  // Read the value now: React clears currentTarget before a state updater runs.
  const set = (key: keyof typeof form) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    let id = '';
    if (await run(async () => (id = (await api.addCompany(form)).tenantId))) {
      setForm({ legalName: '', orgNumber: '', restaurantName: '' });
      notifyOk(t('Company registered. It is waiting for approval.'));
      await onAdded(id);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={650}>{t('Register another company')}</Text>}
    >
      <form onSubmit={submit}>
        <Stack gap="md">
          <Text fz="sm" c="dimmed">
            {t('A separate organisation number. Waits for approval before the registers can sell.')}
          </Text>
          <TextInput
            label={t('Company name')}
            required
            value={form.legalName}
            onChange={set('legalName')}
          />
          <OrgNumberInput
            value={form.orgNumber}
            onChange={(orgNumber) => setForm((f) => ({ ...f, orgNumber }))}
          />
          <TextInput
            label={t('First restaurant')}
            required
            value={form.restaurantName}
            onChange={set('restaurantName')}
          />
          <FormError error={error} />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" loading={busy} disabled={!isOrgNumberOk(form.orgNumber)}>
              {t('Register')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function VerifyBanner({ email }: { email: string }) {
  const t = useT();
  const [sent, setSent] = useState(false);
  const { busy, run } = useAction({ toast: true });
  return (
    <Alert
      color="orange"
      variant="light"
      mb="lg"
      icon={<IconMailExclamation size={18} />}
      title={t('Confirm your email address')}
    >
      {t('Confirm your email address {email} with the link we sent.', { email })}{' '}
      {sent ? (
        t('New link sent.')
      ) : (
        <Anchor
          component="button"
          fz="sm"
          disabled={busy}
          onClick={async () => setSent(await run(() => api.resendVerification()))}
        >
          {t('Send again')}
        </Anchor>
      )}
    </Alert>
  );
}
