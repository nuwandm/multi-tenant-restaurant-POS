import {
  Anchor,
  Button,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconCircleCheck, IconCircleX, IconMailForward } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from './api';
import { AuthLayout } from './AuthLayout';
import { FormError } from './AuthPages';
import { message } from './format';
import { useT } from './i18n';
import { useAction } from './useLoad';

/** Pages opened from email links: #/verify?token=… and #/reset?token=… */
export function linkFromHash(): { page: 'verify' | 'reset'; token: string } | null {
  const match = /^#\/(verify|reset)\?token=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  return match ? { page: match[1] as 'verify' | 'reset', token: match[2]! } : null;
}

function leave(onDone: () => void) {
  window.location.hash = '#/overview';
  onDone();
}

function Result({
  ok,
  title,
  text,
  action,
}: {
  ok: boolean;
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <Stack gap="md" align="flex-start">
      <ThemeIcon size={48} radius="xl" variant="light" color={ok ? 'brand' : 'red'}>
        {ok ? <IconCircleCheck size={28} /> : <IconCircleX size={28} />}
      </ThemeIcon>
      <Title order={2} fz={24}>
        {title}
      </Title>
      <Text c="dimmed">{text}</Text>
      {action}
    </Stack>
  );
}

export function VerifyEmailPage({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
  const [state, setState] = useState<'working' | 'ok' | string>('working');

  useEffect(() => {
    api
      .verifyEmail(token)
      .then(() => setState('ok'))
      .catch((err: unknown) => setState(message(err)));
  }, [token]);

  return (
    <AuthLayout>
      {state === 'working' ? (
        <Stack align="center" gap="sm">
          <Loader type="dots" />
          <Text c="dimmed">{t('Confirming…')}</Text>
        </Stack>
      ) : (
        <Result
          ok={state === 'ok'}
          title={t('Confirm email')}
          text={state === 'ok' ? t('Thank you! Your email address is confirmed.') : t(state)}
          action={
            <Button onClick={() => leave(onDone)} fullWidth>
              {t('Continue')}
            </Button>
          }
        />
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.confirmPasswordReset(token, password))) setDone(true);
  }

  return (
    <AuthLayout>
      {done ? (
        <Result
          ok
          title={t('Your password is changed')}
          text={t('Log in with your new password. You have been logged out everywhere else.')}
          action={
            <Button onClick={() => leave(onDone)} fullWidth>
              {t('Go to login')}
            </Button>
          }
        />
      ) : (
        <form onSubmit={submit}>
          <Stack gap="md">
            <Title order={2} fz={26}>
              {t('Choose a new password')}
            </Title>
            <PasswordInput
              label={t('New password')}
              description={t('At least 10 characters')}
              required
              minLength={10}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <PasswordInput
              label={t('Repeat')}
              required
              autoComplete="new-password"
              value={repeat}
              error={repeat && repeat !== password ? t('The passwords do not match.') : undefined}
              onChange={(e) => setRepeat(e.currentTarget.value)}
            />
            <FormError error={error} />
            <Button type="submit" loading={busy} disabled={password !== repeat}>
              {t('Save')}
            </Button>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.requestPasswordReset(email))) setSent(true);
  }

  if (sent) {
    return (
      <Stack gap="md" align="flex-start">
        <ThemeIcon size={48} radius="xl" variant="light">
          <IconMailForward size={26} />
        </ThemeIcon>
        <Title order={2} fz={24}>
          {t('Check your email')}
        </Title>
        <Text c="dimmed">
          {t(
            'If there is an account for {email}, we have sent a link to choose a new password. The link is valid for one hour.',
            { email },
          )}
        </Text>
        <Button variant="default" fullWidth onClick={onBack}>
          {t('Back to login')}
        </Button>
      </Stack>
    );
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <div>
          <Title order={2} fz={26}>
            {t('Forgot password')}
          </Title>
          <Text c="dimmed" fz="sm" mt={4}>
            {t("Enter your email and we'll send you a link to choose a new password.")}
          </Text>
        </div>
        <TextInput
          label={t('Email')}
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <FormError error={error} />
        <Button type="submit" loading={busy}>
          {t('Send link')}
        </Button>
        <Anchor component="button" type="button" fz="sm" onClick={onBack} ta="center">
          {t('Back to login')}
        </Anchor>
      </Stack>
    </form>
  );
}
