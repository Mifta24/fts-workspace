"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Common");
  return (
    <main className="mx-auto flex flex-1 max-w-md flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold">{t("errorTitle")}</h1>
      <p className="text-muted-foreground">{t("errorBody")}</p>
      <div>
        <Button onClick={reset}>{t("retry")}</Button>
      </div>
    </main>
  );
}
