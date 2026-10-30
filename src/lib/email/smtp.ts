import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage } from "@/lib/email";

/** The part of a nodemailer transport the sender needs; tests pass a fake. */
export type MailTransport = Pick<Transporter, "sendMail">;

const NO_LINE_BREAKS = /[\r\n]/;

/**
 * Plain-text transactional email over SMTP. Messages are built from our own templates, but the
 * recipient and subject can contain user-supplied text (a person's email address, a workspace
 * name), so line breaks, which could inject extra headers, are refused outright.
 */
export function createSmtpSender(transport: MailTransport, from: string) {
  return async function send(message: EmailMessage): Promise<void> {
    if (NO_LINE_BREAKS.test(message.to) || NO_LINE_BREAKS.test(message.subject)) {
      throw new Error("Refusing to send an email with line breaks in its headers");
    }
    await transport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  };
}

/** One connection per send, with timeouts so a dead mail server cannot hang a request. */
export function createSmtpTransport(url: string): MailTransport {
  return nodemailer.createTransport({
    url,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}
