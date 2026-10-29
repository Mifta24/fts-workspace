"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { MAX_FILE_BYTES } from "@/features/files/schemas/file";

export function UploadForm({ organizationSlug }: { organizationSlug: string }) {
  const t = useTranslations("Files");
  const common = useTranslations("Common");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setError(t("errors.INVALID_INPUT"));
    if (file.size > MAX_FILE_BYTES) return setError(t("errors.UNPROCESSABLE"));
    form.set("organizationSlug", organizationSlug);
    setPending(true);
    try {
      const response = await fetch("/api/files", { method: "POST", body: form });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        const code = body?.error?.code;
        setError(
          code === "INVALID_INPUT" || code === "UNPROCESSABLE" || code === "FORBIDDEN"
            ? t(`errors.${code}`)
            : common("genericError"),
        );
        return;
      }
      formRef.current?.reset();
      router.refresh();
    } catch {
      setError(common("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="file-input">{t("fileLabel")}</Label>
        <input
          id="file-input"
          name="file"
          type="file"
          required
          accept=".txt,.md,.csv,.pdf,.png,.jpg,.jpeg,.webp"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-2"
        />
        <p className="text-xs text-muted-foreground">{t("fileHint")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="file-visibility">{t("visibilityLabel")}</Label>
        <Select id="file-visibility" name="visibility" defaultValue="PRIVATE">
          <option value="PRIVATE">{t("visibility.PRIVATE")}</option>
          <option value="ORGANIZATION">{t("visibility.ORGANIZATION")}</option>
        </Select>
      </div>
      <FormMessage tone="error">{error}</FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("upload")}
      </Button>
    </form>
  );
}
