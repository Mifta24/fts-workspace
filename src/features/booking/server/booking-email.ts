import "server-only";
import type { EmailMessage } from "@/lib/email";
import { formatInZone } from "@/lib/time-zone";

type Copy = {
  subject: (title: string) => string;
  body: (v: { name: string; title: string; when: string; cancelUrl: string }) => string;
};

const COPY: Record<"en" | "id" | "ja", Copy> = {
  en: {
    subject: (title) => `Your booking is confirmed: ${title}`,
    body: ({ name, title, when, cancelUrl }) =>
      `Hello ${name},\n\nYour booking "${title}" is confirmed for ${when}.\n\n` +
      `If you can no longer make it, you can cancel here:\n${cancelUrl}\n`,
  },
  id: {
    subject: (title) => `Booking Anda dikonfirmasi: ${title}`,
    body: ({ name, title, when, cancelUrl }) =>
      `Halo ${name},\n\nBooking "${title}" Anda dikonfirmasi untuk ${when}.\n\n` +
      `Jika Anda tidak bisa hadir, Anda dapat membatalkannya di sini:\n${cancelUrl}\n`,
  },
  ja: {
    subject: (title) => `ご予約が確定しました: ${title}`,
    body: ({ name, title, when, cancelUrl }) =>
      `${name} 様\n\n「${title}」のご予約が ${when} で確定しました。\n\n` +
      `ご都合が悪くなった場合は、こちらからキャンセルできます:\n${cancelUrl}\n`,
  },
};

/** The confirmation a visitor gets after booking: the time, and a secret link to cancel. */
export function bookingConfirmationEmail(input: {
  to: string;
  name: string;
  title: string;
  startsAt: Date;
  timeZone: string;
  locale: string;
  cancelUrl: string;
}): EmailMessage {
  const copy = COPY[input.locale as keyof typeof COPY] ?? COPY.en;
  const when = `${formatInZone(input.startsAt, input.timeZone)} (${input.timeZone})`;
  return {
    to: input.to,
    subject: copy.subject(input.title),
    text: copy.body({
      name: input.name,
      title: input.title,
      when,
      cancelUrl: input.cancelUrl,
    }),
  };
}
