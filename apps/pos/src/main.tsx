import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './design.css';
import './app.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from './i18n';
import { Root } from './Root';
import { ErrorBoundary } from './ErrorBoundary';
import { createAppTheme } from './theme';

const theme = createAppTheme('comfortable');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-center" />
      <LanguageProvider>
        <ErrorBoundary>
          <Root />
        </ErrorBoundary>
      </LanguageProvider>
    </MantineProvider>
  </StrictMode>,
);
