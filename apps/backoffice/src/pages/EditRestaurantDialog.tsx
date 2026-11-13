import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { api, type Restaurant } from '../api';
import { useT } from '../i18n';
import { notifyOk } from '../notify';
import { useAction } from '../useLoad';

/** Name and address. The address is printed on every receipt, so it is needed to sell. */
export function EditRestaurantDialog({
  tenantId,
  restaurant,
  onClose,
  onSaved,
}: {
  tenantId: string;
  restaurant: Restaurant;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(restaurant.name);
  const [address, setAddress] = useState(restaurant.address ?? '');
  const action = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), address: address.trim() || null };
    if (await action.run(() => api.updateRestaurant(tenantId, restaurant.id, body))) {
      notifyOk(t('Saved'));
      onSaved();
    }
  }

  return (
    <Modal opened onClose={onClose} title={<Text fw={650}>{t('Edit restaurant')}</Text>}>
      <form onSubmit={submit}>
        <Stack gap="md">
          <TextInput
            required
            label={t('Name')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label={t('Address')}
            description={t('Printed on every receipt. Needed before the tills can sell.')}
            placeholder={t('Street and number, postcode and town')}
            value={address}
            onChange={(e) => setAddress(e.currentTarget.value)}
            maxLength={72}
            error={action.error ? t(action.error) : undefined}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" loading={action.busy} disabled={!name.trim()}>
              {t('Save')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
