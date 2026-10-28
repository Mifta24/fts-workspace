import { getTranslations } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";

export default async function Page() {
  const t = await getTranslations("Auth");
  return (
    <Card className="space-y-4">
      <CardTitle>{t("verifyTitle")}</CardTitle>
      <p className="text-muted-foreground">{t("verifyBody")}</p>
      <Link href="/sign-in" className="text-sm text-primary hover:underline">
        {t("backToSignIn")}
      </Link>
    </Card>
  );
}
