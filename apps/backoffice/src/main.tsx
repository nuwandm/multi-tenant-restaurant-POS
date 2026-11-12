import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/notifications/styles.css';
import './design.css';
import './app.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmProvider } from './confirm';
import { LanguageProvider } from './i18n';
import { Root } from './Root';
import { ErrorBoundary } from './ErrorBoundary';
import { createAppTheme } from './theme';

const theme = createAppTheme('compact');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="bottom-right" />
      <LanguageProvider>
        <ConfirmProvider>
          <ErrorBoundary>
            <Root />
          </ErrorBoundary>
        </ConfirmProvider>
      </LanguageProvider>
    </MantineProvider>
  </StrictMode>,
);
