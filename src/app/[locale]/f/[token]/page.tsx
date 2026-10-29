import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicFormClient } from "@/features/forms/components/public-form";
import { getPublicForm } from "@/features/forms/server/forms-service";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";

export default async function PublicFormPage({ params }: PageProps<"/[locale]/f/[token]">) {
  const { token } = await params;
  const form = await getPublicForm({ prisma: db() }, token).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const t = await getTranslations("PublicForm");

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-4 py-10">
      <p className="text-sm text-muted-foreground">{form.organizationName}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{form.title}</h1>
      {form.description && <p className="text-muted-foreground">{form.description}</p>}
      <PublicFormClient token={token} fields={form.fields} consentText={form.consentText} />
      <p className="text-xs text-muted-foreground">{t("privacy")}</p>
    </main>
  );
}
