import "server-only";
import { env } from "@/lib/env";
import { createSmtpSender, createSmtpTransport } from "@/lib/email/smtp";
import { logger } from "@/lib/logger";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

/** Messages captured by the log transport while running tests. */
export const testOutbox: EmailMessage[] = [];

let smtpSender: ((message: EmailMessage) => Promise<void>) | undefined;

/**
 * Sends a transactional email: through the log in development and tests, or through the SMTP
 * provider named by `SMTP_URL`. Delivery errors are logged without the connection details and
 * rethrown as a plain error, so callers decide whether a failed email should fail their request.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const config = env();
  switch (config.EMAIL_TRANSPORT) {
    case "smtp": {
      smtpSender ??= createSmtpSender(createSmtpTransport(config.SMTP_URL!), config.EMAIL_FROM);
      try {
        await smtpSender(message);
      } catch (error) {
        logger.error(
          { err: { name: (error as Error).name, code: (error as { code?: string }).code } },
          "email delivery failed",
        );
        throw new Error("Email delivery failed");
      }
      return;
    }
    case "log": {
      if (config.NODE_ENV === "test") {
        testOutbox.push(message);
        return;
      }
      logger.info(
        { email: { from: config.EMAIL_FROM, to: message.to, subject: message.subject } },
        `[dev email]\n${message.text}`,
      );
      return;
    }
  }
}
