import { Button, Center, Code, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconRefresh, IconBug } from '@tabler/icons-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { translate } from './i18n';

interface State {
  error: Error | null;
}

/** Shows a calm recovery screen instead of a blank page if a screen crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Center mih="100vh" p="md">
        <Stack align="center" gap="sm" maw={440} ta="center">
          <ThemeIcon size={52} radius="xl" color="red">
            <IconBug size={26} stroke={1.6} />
          </ThemeIcon>
          <Title order={3}>{translate('Something went wrong')}</Title>
          <Text c="dimmed" fz="sm">
            {translate('The page hit an unexpected error. Reloading usually fixes it.')}
          </Text>
          <Code fz="xs" c="dimmed">
            {error.message}
          </Code>
          <Button mt="sm" leftSection={<IconRefresh size={16} />} onClick={() => location.reload()}>
            {translate('Reload')}
          </Button>
        </Stack>
      </Center>
    );
  }
}
