import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/features/auth/components/auth-forms";

export default async function Page({ searchParams }: PageProps<"/[locale]/reset-password">) {
  const t = await getTranslations("Auth");
  const { token, error } = await searchParams;
  const validToken = typeof token === "string" && !error ? token : null;
  return (
    <Card className="space-y-6">
      <CardTitle>{t("resetTitle")}</CardTitle>
      <ResetPasswordForm token={validToken} />
    </Card>
  );
}
