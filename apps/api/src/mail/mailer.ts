export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends email. A provider adapter (SMTP, Postmark, SES…) plugs in here when one is chosen. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development: prints the email to the API log instead of sending it. */
export class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    console.log(
      `\n──── email (not sent, dev mode) ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n───────────────────────────────────\n`,
    );
  }
}

/** Tests: keeps sent emails in memory. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastTo(to: string): MailMessage | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }
}
