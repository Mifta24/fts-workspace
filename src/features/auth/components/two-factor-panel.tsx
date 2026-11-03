"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";

type Setup = { uri: string; key: string; recoveryCodes: string[] };

const field = (form: HTMLFormElement, name: string) => String(new FormData(form).get(name) ?? "");

function RecoveryCodes({ codes }: { codes: string[] }) {
  const t = useTranslations("Security");
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("recoveryTitle")}</p>
      <p className="text-sm text-muted-foreground">{t("recoveryHint")}</p>
      <ul
        className="grid grid-cols-2 gap-1 rounded-md border border-input bg-muted p-3 font-mono text-sm"
        data-testid="recovery-codes"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </div>
  );
}

/** Turn two-step sign-in on or off, and replace the recovery codes. */
export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Security");
  const common = useTranslations("Common");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [setup, setSetup] = useState<Setup>();
  const [newCodes, setNewCodes] = useState<string[]>();

  async function run(action: () => Promise<{ error: unknown } | void>, after?: () => void) {
    setPending(true);
    setError(undefined);
    const result = await action();
    setPending(false);
    if (result && result.error) return setError(t("failed"));
    after?.();
  }

  function turnOn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = field(event.currentTarget, "password");
    void run(async () => {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data || !("totpURI" in data)) return { error: error ?? true };
      const key = new URL(data.totpURI).searchParams.get("secret") ?? "";
      setSetup({ uri: data.totpURI, key, recoveryCodes: data.backupCodes });
    });
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = field(event.currentTarget, "code").replace(/\s/g, "");
    void run(
      () => authClient.twoFactor.verifyTotp({ code }),
      () => {
        // Keep the recovery codes on screen: this is the last time they are shown.
        setNewCodes(setup?.recoveryCodes);
        setSetup(undefined);
        router.refresh();
      },
    );
  }

  function turnOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = field(event.currentTarget, "password");
    void run(
      () => authClient.twoFactor.disable({ password }),
      () => {
        setNewCodes(undefined);
        router.refresh();
      },
    );
  }

  function replaceCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = field(event.currentTarget, "password");
    void run(async () => {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
      if (error || !data) return { error: error ?? true };
      setNewCodes(data.backupCodes);
    });
  }

  const passwordField = (id: string) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("passwordLabel")}</Label>
      <Input id={id} name="password" type="password" autoComplete="current-password" required />
    </div>
  );

  if (setup) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm">{t("setupSteps")}</p>
          <p className="text-sm font-medium">{t("keyLabel")}</p>
          <code className="block break-all rounded-md bg-muted p-3 text-sm" data-testid="totp-key">
            {setup.key}
          </code>
          <a href={setup.uri} className="text-sm text-primary hover:underline">
            {t("openInApp")}
          </a>
        </div>
        <RecoveryCodes codes={setup.recoveryCodes} />
        <form onSubmit={confirm} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">{t("codeLabel")}</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </div>
          <FormMessage tone="error">{error}</FormMessage>
          <Button type="submit" disabled={pending}>
            {pending ? common("loading") : t("confirm")}
          </Button>
        </form>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="space-y-6">
        <p className="font-medium" data-testid="mfa-status">
          {t("statusOn")}
        </p>
        <form onSubmit={replaceCodes} className="space-y-4">
          {passwordField("codes-password")}
          <Button type="submit" variant="outline" disabled={pending}>
            {t("newRecoveryCodes")}
          </Button>
        </form>
        {newCodes ? <RecoveryCodes codes={newCodes} /> : null}
        <form onSubmit={turnOff} className="space-y-4 border-t pt-4">
          <p className="text-sm text-muted-foreground">{t("turnOffHint")}</p>
          {passwordField("off-password")}
          <FormMessage tone="error">{error}</FormMessage>
          <Button type="submit" variant="outline" disabled={pending}>
            {t("turnOff")}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={turnOn} className="space-y-4">
      <p className="font-medium" data-testid="mfa-status">
        {t("statusOff")}
      </p>
      {passwordField("on-password")}
      <FormMessage tone="error">{error}</FormMessage>
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("turnOn")}
      </Button>
    </form>
  );
}
