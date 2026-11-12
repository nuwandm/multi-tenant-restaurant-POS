import type { FastifyInstance } from 'fastify';
import type { Sql, TransactionSql } from 'postgres';
import type { AppDeps } from '../app';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/pin';
import { hashToken, newSessionToken } from '../auth/session';
import { HttpError } from '../errors';
import { requireAdmin } from './admin-session';

type Purpose = 'verify_email' | 'reset_password';

const VALID_HOURS: Record<Purpose, number> = { verify_email: 72, reset_password: 1 };

/** Runs fn as pos_app without any tenant: users and email tokens are not tenant data. */
async function asApp<T>(sql: Sql, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE pos_app`;
    return fn(tx);
  });
  return result as T;
}

async function issueToken(tx: TransactionSql, userId: string, purpose: Purpose): Promise<string> {
  const { token, tokenHash } = newSessionToken();
  await tx`
    INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at)
    VALUES (${tokenHash}, ${userId}, ${purpose},
            ${new Date(Date.now() + VALID_HOURS[purpose] * 3_600_000)})`;
  return token;
}

/** Uses a token once. Returns the user it belongs to, or null if wrong, used or expired. */
async function consumeToken(
  tx: TransactionSql,
  token: string,
  purpose: Purpose,
): Promise<string | null> {
  const [row] = await tx<{ user_id: string }[]>`
    UPDATE email_tokens SET used_at = now()
    WHERE token_hash = ${hashToken(token)} AND purpose = ${purpose}
      AND used_at IS NULL AND expires_at > now()
    RETURNING user_id`;
  return row?.user_id ?? null;
}

/** Sends the "confirm your email" message. Called after sign-up and on request. */
export async function sendVerificationEmail(deps: AppDeps, userId: string): Promise<void> {
  const user = await asApp(deps.sql, async (tx) => {
    const [u] = await tx<{ email: string | null; display_name: string; verified: boolean }[]>`
      SELECT email, display_name, email_verified_at IS NOT NULL AS verified FROM users WHERE id = ${userId}`;
    if (!u?.email || u.verified) return null;
    return { ...u, token: await issueToken(tx, userId, 'verify_email') };
  });
  if (!user) return;
  await deps.mailer.send({
    to: user.email!,
    subject: 'Bekräfta din e-postadress',
    text: `Hej ${user.display_name}!\n\nBekräfta din e-postadress genom att öppna länken:\n${deps.backofficeUrl}/#/verify?token=${user.token}\n\nLänken gäller i ${VALID_HOURS.verify_email} timmar.`,
  });
}

export function emailRoutes(app: FastifyInstance, deps: AppDeps) {
  const tokenBody = (extra: Record<string, unknown> = {}) => ({
    body: {
      type: 'object',
      required: ['token', ...Object.keys(extra)],
      additionalProperties: false,
      properties: { token: { type: 'string', minLength: 20, maxLength: 100 }, ...extra },
    },
  });

  app.post<{ Body: { token: string } }>(
    '/admin/verify-email',
    { schema: tokenBody() },
    async (req) => {
      const verified = await asApp(deps.sql, async (tx) => {
        const userId = await consumeToken(tx, req.body.token, 'verify_email');
        if (userId) await tx`UPDATE users SET email_verified_at = now() WHERE id = ${userId}`;
        return userId !== null;
      });
      if (!verified)
        throw new HttpError(400, 'invalid_token', 'The link is wrong, used or expired');
      return { verified: true };
    },
  );

  app.post(
    '/admin/resend-verification',
    { preHandler: requireAdmin(deps.sql) },
    async (req, reply) => {
      await sendVerificationEmail(deps, req.admin!.userId);
      return reply.status(204).send();
    },
  );

  // Always answers the same way, so it can't be used to find out which emails have accounts.
  app.post<{ Body: { email: string } }>(
    '/admin/password-reset',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: { email: { type: 'string', minLength: 3, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const found = await asApp(deps.sql, async (tx) => {
        const [user] = await tx<{ id: string; email: string; display_name: string }[]>`
          SELECT id, email, display_name FROM users
          WHERE lower(email) = lower(${req.body.email.trim()}) AND password_hash IS NOT NULL`;
        return user ? { ...user, token: await issueToken(tx, user.id, 'reset_password') } : null;
      });
      if (found) {
        await deps.mailer.send({
          to: found.email,
          subject: 'Återställ ditt lösenord',
          text: `Hej ${found.display_name}!\n\nÖppna länken för att välja ett nytt lösenord:\n${deps.backofficeUrl}/#/reset?token=${found.token}\n\nLänken gäller i en timme. Om du inte bad om detta kan du strunta i mejlet.`,
        });
      }
      return reply.status(204).send();
    },
  );

  // A new password logs the user out everywhere and unlocks the account. Opening the link also
  // proves they own the email address.
  app.post<{ Body: { token: string; password: string } }>(
    '/admin/password-reset/confirm',
    {
      schema: tokenBody({
        password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 200 },
      }),
    },
    async (req) => {
      const passwordHash = await hashPassword(req.body.password);
      const done = await asApp(deps.sql, async (tx) => {
        const userId = await consumeToken(tx, req.body.token, 'reset_password');
        if (!userId) return false;
        await tx`
          UPDATE users SET password_hash = ${passwordHash}, failed_login_attempts = 0,
                           locked_until = NULL, email_verified_at = coalesce(email_verified_at, now())
          WHERE id = ${userId}`;
        await tx`UPDATE admin_sessions SET ended_at = now() WHERE user_id = ${userId} AND ended_at IS NULL`;
        return true;
      });
      if (!done) throw new HttpError(400, 'invalid_token', 'The link is wrong, used or expired');
      return { reset: true };
    },
  );
}
