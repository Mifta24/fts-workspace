import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

/** Messages captured by the log transport while running tests. */
export const testOutbox: EmailMessage[] = [];

/**
 * Sends a transactional email. Only the development `log` transport exists in
 * Phase 0; a real provider must be added (and reviewed) before production.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const config = env();
  switch (config.EMAIL_TRANSPORT) {
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
