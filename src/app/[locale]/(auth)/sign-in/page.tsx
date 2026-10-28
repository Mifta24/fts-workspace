import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { SignInForm } from "@/features/auth/components/auth-forms";

export default async function Page() {
  const t = await getTranslations("Auth");
  return (
    <Card className="space-y-6">
      <CardTitle>{t("signInTitle")}</CardTitle>
      <SignInForm />
    </Card>
  );
}
