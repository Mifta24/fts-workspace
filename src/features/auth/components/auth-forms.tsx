"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";

function Field(props: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  hint?: string;
  minLength?: number;
}) {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        name={props.id}
        type={props.type}
        autoComplete={props.autoComplete}
        minLength={props.minLength}
        aria-describedby={hintId}
        required
      />
      {props.hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  return { pending, setPending, error, setError, success, setSuccess };
}

function value(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "");
}

export function SignInForm() {
  const t = useTranslations("Auth");
  const common = useTranslations("Common");
  const router = useRouter();
  const state = useSubmit();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    state.setPending(true);
    state.setError(undefined);
    const form = event.currentTarget;
    const { error } = await authClient.signIn.email({
      email: value(form, "email"),
      password: value(form, "password"),
    });
    state.setPending(false);
    if (error) return state.setError(t("signInFailed"));
    router.push("/workspaces");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      <Field id="email" label={t("email")} type="email" autoComplete="email" />
      <Field id="password" label={t("password")} type="password" autoComplete="current-password" />
      <FormMessage tone="error">{state.error}</FormMessage>
      <Button type="submit" className="w-full" disabled={state.pending}>
        {state.pending ? common("loading") : t("signInSubmit")}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">
          {t("forgotPassword")}
        </Link>
        <Link href="/sign-up" className="text-primary hover:underline">
          {t("noAccount")}
        </Link>
      </div>
    </form>
  );
}

export function SignUpForm() {
  const t = useTranslations("Auth");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const state = useSubmit();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    state.setPending(true);
    state.setError(undefined);
    const form = event.currentTarget;
    const { error } = await authClient.signUp.email({
      name: value(form, "name"),
      email: value(form, "email"),
      password: value(form, "password"),
      callbackURL: `/${locale}/workspaces`,
    });
    state.setPending(false);
    if (error) return state.setError(t("signUpFailed"));
    router.push("/verify-email");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field id="name" label={t("name")} type="text" autoComplete="name" />
      <Field id="email" label={t("email")} type="email" autoComplete="email" />
      <Field
        id="password"
        label={t("password")}
        type="password"
        autoComplete="new-password"
        hint={t("passwordHint")}
        minLength={12}
      />
      <FormMessage tone="error">{state.error}</FormMessage>
      <Button type="submit" className="w-full" disabled={state.pending}>
        {state.pending ? common("loading") : t("signUpSubmit")}
      </Button>
      <p className="text-sm">
        <Link href="/sign-in" className="text-primary hover:underline">
          {t("haveAccount")}
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const common = useTranslations("Common");
  const locale = useLocale();
  const state = useSubmit();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    state.setPending(true);
    state.setError(undefined);
    const form = event.currentTarget;
    await authClient.requestPasswordReset({
      email: value(form, "email"),
      redirectTo: `/${locale}/reset-password`,
    });
    state.setPending(false);
    // Same message whether or not the account exists (no account enumeration).
    state.setSuccess(t("forgotSent"));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field id="email" label={t("email")} type="email" autoComplete="email" />
      <FormMessage tone="success">{state.success}</FormMessage>
      <Button type="submit" className="w-full" disabled={state.pending}>
        {state.pending ? common("loading") : t("forgotSubmit")}
      </Button>
      <p className="text-sm">
        <Link href="/sign-in" className="text-primary hover:underline">
          {t("backToSignIn")}
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations("Auth");
  const common = useTranslations("Common");
  const state = useSubmit();

  if (!token) return <FormMessage tone="error">{t("resetInvalid")}</FormMessage>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    state.setPending(true);
    state.setError(undefined);
    const { error } = await authClient.resetPassword({
      newPassword: value(event.currentTarget, "password"),
      token: token ?? "",
    });
    state.setPending(false);
    if (error) return state.setError(t("resetInvalid"));
    state.setSuccess(t("resetDone"));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field
        id="password"
        label={t("password")}
        type="password"
        autoComplete="new-password"
        hint={t("passwordHint")}
        minLength={12}
      />
      <FormMessage tone="error">{state.error}</FormMessage>
      <FormMessage tone="success">{state.success}</FormMessage>
      <Button type="submit" className="w-full" disabled={state.pending}>
        {state.pending ? common("loading") : t("resetSubmit")}
      </Button>
      <p className="text-sm">
        <Link href="/sign-in" className="text-primary hover:underline">
          {t("backToSignIn")}
        </Link>
      </p>
    </form>
  );
}

export function SignOutButton() {
  const t = useTranslations("Common");
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await authClient.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    >
      {t("signOut")}
    </Button>
  );
}
