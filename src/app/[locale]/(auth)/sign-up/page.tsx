import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { SignUpForm } from "@/features/auth/components/auth-forms";
import { Link } from "@/i18n/navigation";

export default async function Page() {
  const t = await getTranslations("Auth");
  return (
    <Card className="space-y-6">
      <CardTitle>{t("signUpTitle")}</CardTitle>
      <SignUpForm />
      <p className="text-xs text-muted-foreground">
        {t.rich("signUpTerms", {
          terms: (chunks) => (
            <Link href="/terms" className="underline">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/privacy" className="underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </Card>
  );
}
