import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { LegalDocument } from "@/features/legal/components/legal-document";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Legal");
  return { title: t("terms") };
}

export default async function Page() {
  // Reads the operator name and contact from the server environment, so it is never built ahead.
  await connection();
  return <LegalDocument kind="termsDoc" />;
}
