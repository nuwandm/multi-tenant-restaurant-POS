import {
  Alert,
  Button,
  Card,
  Group,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconDownload, IconFileCode, IconInfoCircle } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { PageHeader } from '../PageHeader';
import { useAction, useLoad } from '../useLoad';

const stockholmDay = (d: Date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(d);

/**
 * The journal memory as the XML file Skatteverket asks for (SKVFS 2021:16), per restaurant,
 * for any registers and period. The API checks every file against Skatteverket's schema.
 */
export function JournalExportPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const restaurants = useLoad(() => api.restaurants(tenantId), [tenantId]);
  const list = restaurants.data?.restaurants ?? [];
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [registerIds, setRegisterIds] = useState<string[]>([]);
  const today = stockholmDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const action = useAction();

  useEffect(() => {
    const all = restaurants.data?.restaurants ?? [];
    if (all.length > 0 && !all.some((r) => r.id === restaurantId)) setRestaurantId(all[0]!.id);
  }, [restaurants.data, restaurantId]);

  const restaurant = list.find((r) => r.id === restaurantId);
  const registers = restaurant?.registers.filter((r) => r.enrolled) ?? [];

  async function download() {
    if (!restaurantId) return;
    const got: { file?: { blob: Blob; fileName: string } } = {};
    const ok = await action.run(async () => {
      got.file = await api.journalExport(tenantId, { restaurantId, registerIds, from, to });
    });
    const file = got.file;
    if (!ok || !file) return;
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.fileName;
    a.click();
    URL.revokeObjectURL(url);
    notifyOk(t('{name} is downloaded.', { name: file.fileName }));
  }

  return (
    <>
      <PageHeader
        title={t('Journal export')}
        description={t(
          'Everything the registers recorded, as the XML file Skatteverket asks for during an inspection.',
        )}
      />
      <Card withBorder radius="lg" p="lg" maw={720}>
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Select
              label={t('Restaurant')}
              allowDeselect={false}
              value={restaurantId}
              onChange={(v) => {
                setRestaurantId(v);
                setRegisterIds([]);
              }}
              data={list.map((r) => ({ value: r.id, label: r.name }))}
            />
            <MultiSelect
              label={t('Registers')}
              placeholder={registerIds.length === 0 ? t('All registers') : undefined}
              value={registerIds}
              onChange={setRegisterIds}
              data={registers.map((r) => ({ value: r.id, label: r.designation }))}
              clearable
            />
            <TextInput
              type="date"
              label={t('From')}
              value={from}
              max={to}
              onChange={(e) => setFrom(e.currentTarget.value)}
            />
            <TextInput
              type="date"
              label={t('To')}
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.currentTarget.value)}
            />
          </SimpleGrid>

          {restaurant && !restaurant.address && (
            <Alert color="orange" variant="light" icon={<IconInfoCircle size={18} />}>
              {t('Add the restaurant address on Restaurants & registers first.')}
            </Alert>
          )}
          {action.error && (
            <Alert color="red" variant="light">
              {t(action.error)}
            </Alert>
          )}

          <Group justify="space-between" wrap="wrap">
            <Group gap={8} c="dimmed">
              <IconFileCode size={16} />
              <Text fz="xs">{t('UTF-8 XML, checked against Skatteverket’s schema.')}</Text>
            </Group>
            <Button
              leftSection={<IconDownload size={18} />}
              loading={action.busy}
              disabled={!restaurantId || !from || !to || from > to}
              onClick={download}
            >
              {t('Download XML')}
            </Button>
          </Group>
        </Stack>
      </Card>
    </>
  );
}
