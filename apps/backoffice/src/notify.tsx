import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { translate } from './i18n';

export function notifyOk(message: string) {
  notifications.show({
    message,
    color: 'brand',
    icon: <IconCheck size={18} />,
    autoClose: 2500,
  });
}

export function notifyError(message: string) {
  notifications.show({
    title: translate('Something went wrong'),
    message: translate(message),
    color: 'red',
    icon: <IconAlertCircle size={18} />,
    autoClose: 6000,
  });
}
