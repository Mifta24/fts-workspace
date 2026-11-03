import { getLocale, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ProgressThread } from "@/components/ui/progress-thread";
import { Link, redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/session";

const SAMPLE_TASKS = ["sampleTask1", "sampleTask2", "sampleTask3"] as const;
const FLOW_STEPS = [
  { title: "step1Title", body: "step1Body" },
  { title: "step2Title", body: "step2Body" },
  { title: "step3Title", body: "step3Body" },
] as const;
const FEATURES = [
  { title: "featureGoalsTitle", body: "featureGoalsBody" },
  { title: "featureTeamTitle", body: "featureTeamBody" },
  { title: "featureAiTitle", body: "featureAiBody" },
  { title: "featureKnowledgeTitle", body: "featureKnowledgeBody" },
  { title: "featureCustomersTitle", body: "featureCustomersBody" },
  { title: "featureScheduleTitle", body: "featureScheduleBody" },
] as const;
const PRICING_PLANS = [
  {
    name: "free",
    title: "planFree",
    price: "priceFreeAmount",
    features: ["priceFreeFeature1", "priceFreeFeature2", "priceFreeFeature3"],
  },
  {
    name: "team",
    title: "planTeam",
    price: "priceTeamAmount",
    features: ["priceTeamFeature1", "priceTeamFeature2", "priceTeamFeature3"],
    featured: true,
  },
  {
    name: "business",
    title: "planBusiness",
    price: "priceBusinessAmount",
    features: ["priceBusinessFeature1", "priceBusinessFeature2", "priceBusinessFeature3"],
  },
] as const;
const PRIVACY_POINTS = ["privacyPoint1", "privacyPoint2", "privacyPoint3"] as const;
const USE_CASES = [
  { title: "individualTitle", body: "individualBody", example: "individualExample" },
  { title: "teamTitle", body: "teamBody", example: "teamExample" },
] as const;
const START_STEPS = [
  { title: "start1Title", body: "start1Body" },
  { title: "start2Title", body: "start2Body" },
  { title: "start3Title", body: "start3Body" },
] as const;
const FAQ_ITEMS = [
  { question: "faq1Question", answer: "faq1Answer" },
  { question: "faq2Question", answer: "faq2Answer" },
  { question: "faq3Question", answer: "faq3Answer" },
] as const;
const LANGUAGES = [
  { code: "en", label: "EN" },
  { code: "id", label: "ID" },
  { code: "ja", label: "日本語" },
] as const;

export default async function HomePage() {
  const [locale, t, user] = await Promise.all([
    getLocale(),
    getTranslations("Home"),
    getSessionUser(),
  ]);
  if (user) redirect({ href: "/workspaces", locale });

  return (
    <>
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="grid size-8 grid-cols-2 gap-1 rounded-lg border border-border p-1.5"
            >
              <span className="rounded-sm bg-primary" />
              <span className="rounded-sm bg-primary/60" />
              <span className="rounded-sm bg-primary/40" />
              <span className="rounded-sm bg-primary/20" />
            </span>
            <span>{t("brand")}</span>
          </Link>

          <nav
            aria-label={t("mainNavigation")}
            className="order-3 flex w-full gap-5 overflow-x-auto pb-1 text-sm text-muted-foreground md:order-none md:w-auto md:pb-0"
          >
            <a className="whitespace-nowrap hover:text-foreground" href="#how-it-works">
              {t("howItWorks")}
            </a>
            <a className="whitespace-nowrap hover:text-foreground" href="#features">
              {t("capabilities")}
            </a>
            <a className="whitespace-nowrap hover:text-foreground" href="#pricing">
              {t("pricingNav")}
            </a>
            <a className="whitespace-nowrap hover:text-foreground" href="#privacy">
              {t("privacyNav")}
            </a>
            <a className="whitespace-nowrap hover:text-foreground" href="#faq">
              {t("faqNav")}
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <nav aria-label={t("languageNavigation")} className="flex items-center gap-2 text-xs">
              {LANGUAGES.map((language) => (
                <Link
                  key={language.code}
                  href="/"
                  locale={language.code}
                  aria-current={locale === language.code ? "page" : undefined}
                  className={`rounded px-1 py-1 ${locale === language.code ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {language.label}
                </Link>
              ))}
            </nav>
            <Link href="/sign-in" className="text-sm font-medium hover:text-primary">
              {t("signIn")}
            </Link>
            <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
              {t("signUp")}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section
          aria-labelledby="home-title"
          className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 md:grid-cols-[0.92fr_1.08fr] md:px-8 md:py-24 lg:gap-20"
        >
          <div className="space-y-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-primary">
              <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              {t("heroEyebrow")}
            </p>
            <h1
              id="home-title"
              className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-balance sm:text-5xl lg:text-6xl"
            >
              {t("title")}
            </h1>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground">{t("subtitle")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/sign-up" className={`${buttonVariants()} h-12 px-5 text-base`}>
                {t("primaryCta")}
              </Link>
              <a
                href="#how-it-works"
                className={`${buttonVariants({ variant: "outline" })} h-12 px-5 text-base`}
              >
                {t("secondaryCta")}
              </a>
            </div>
            <p className="text-sm text-muted-foreground">{t("heroNote")}</p>
          </div>

          <section
            aria-label={t("samplePanelLabel")}
            className="rounded-2xl border border-border bg-card p-5 sm:p-7"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
                {t("sampleWorkspace")}
              </div>
              <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                {t("sampleLabel")}
              </span>
            </div>
            <div className="space-y-5 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t("sampleGoalLabel")}</p>
                  <h2 className="text-xl font-semibold tracking-tight">{t("sampleGoal")}</h2>
                </div>
                <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                  {t("sampleTeam")}
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span>{t("sampleProgressLabel")}</span>
                  <span className="font-semibold tabular-nums">68%</span>
                </div>
                <ProgressThread value={68} label={t("sampleProgressLabel")} />
              </div>
              <ul className="space-y-3 border-t border-border pt-4">
                {SAMPLE_TASKS.map((task, index) => (
                  <li key={task} className="flex items-center gap-3 text-sm">
                    <span
                      aria-hidden="true"
                      className={`grid size-5 shrink-0 place-items-center rounded-full border text-xs ${index === 0 ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground"}`}
                    >
                      {index === 0 ? "✓" : index + 1}
                    </span>
                    <span className={index === 0 ? "text-muted-foreground line-through" : ""}>
                      {index === 0 && <span className="sr-only">{t("sampleTaskDone")} </span>}
                      {t(task)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
                <span>{t("sampleTeamWork")}</span>
                <span role="img" className="flex -space-x-1.5" aria-label={t("sampleTeamMembers")}>
                  {[
                    { initial: "A", tone: "bg-primary text-primary-foreground" },
                    { initial: "M", tone: "bg-muted text-foreground" },
                    { initial: "R", tone: "bg-card text-foreground" },
                  ].map((member) => (
                    <span
                      key={member.initial}
                      className={`grid size-7 place-items-center rounded-full border border-card text-[10px] font-semibold ${member.tone}`}
                    >
                      {member.initial}
                    </span>
                  ))}
                </span>
              </div>
            </div>
            <p className="border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
              {t("sampleCaption")}
            </p>
          </section>
        </section>

        <section aria-label={t("overviewLabel")} className="border-y border-border bg-muted/50">
          <div className="mx-auto grid max-w-7xl gap-5 px-5 py-8 sm:grid-cols-[1fr_2fr] sm:items-center md:px-8">
            <p className="text-sm font-medium">{t("overviewTitle")}</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <li>{t("overviewGoals")}</li>
              <li>{t("overviewPeople")}</li>
              <li>{t("overviewKnowledge")}</li>
              <li>{t("overviewCustomers")}</li>
              <li>{t("overviewProgress")}</li>
            </ul>
          </div>
        </section>

        <section
          id="how-it-works"
          aria-labelledby="flow-title"
          className="mx-auto max-w-7xl scroll-mt-8 px-5 py-20 md:px-8 md:py-28"
        >
          <div className="max-w-2xl space-y-4">
            <p className="text-sm font-semibold text-primary">{t("flowEyebrow")}</p>
            <h2
              id="flow-title"
              className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
            >
              {t("flowTitle")}
            </h2>
            <p className="text-lg leading-8 text-muted-foreground">{t("flowBody")}</p>
          </div>
          <ol className="mt-10 grid gap-0 border-y border-border md:grid-cols-3 md:divide-x md:divide-border">
            {FLOW_STEPS.map((step, index) => (
              <li
                key={step.title}
                className="space-y-4 border-b border-border py-6 md:border-b-0 md:px-7 md:py-8 first:md:pl-0 last:border-b-0 last:md:pr-0"
              >
                <span className="text-sm font-semibold tabular-nums text-primary">
                  0{index + 1}
                </span>
                <h3 className="text-xl font-semibold">{t(step.title)}</h3>
                <p className="leading-7 text-muted-foreground">{t(step.body)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="features"
          aria-labelledby="features-title"
          className="scroll-mt-8 border-y border-border bg-muted/40"
        >
          <div className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
            <div className="max-w-2xl space-y-4">
              <p className="text-sm font-semibold text-primary">{t("featuresEyebrow")}</p>
              <h2
                id="features-title"
                className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
              >
                {t("featuresTitle")}
              </h2>
              <p className="text-lg leading-8 text-muted-foreground">{t("featuresBody")}</p>
            </div>
            <div className="mt-10 grid gap-0 border-y border-border sm:grid-cols-2 sm:divide-x sm:divide-border lg:grid-cols-3">
              {FEATURES.map((feature, index) => (
                <article
                  key={feature.title}
                  className="border-b border-border py-6 sm:px-6 sm:even:border-r-0 lg:border-b-0 lg:px-7 lg:py-8 [&:nth-child(n+4)]:lg:border-t [&:nth-child(3n+1)]:lg:pl-0 [&:nth-child(3n)]:lg:pr-0"
                >
                  <p className="text-sm font-semibold tabular-nums text-primary">0{index + 1}</p>
                  <h3 className="mt-4 text-lg font-semibold">{t(feature.title)}</h3>
                  <p className="mt-2 leading-7 text-muted-foreground">{t(feature.body)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="pricing"
          aria-labelledby="pricing-title"
          className="scroll-mt-8 border-y border-border bg-muted/40"
        >
          <div className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
            <div className="mx-auto max-w-2xl space-y-4 text-center">
              <p className="text-sm font-semibold text-primary">{t("pricingEyebrow")}</p>
              <h2
                id="pricing-title"
                className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
              >
                {t("pricingTitle")}
              </h2>
              <p className="text-lg leading-8 text-muted-foreground">{t("pricingBody")}</p>
            </div>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {PRICING_PLANS.map((plan) => (
                <article
                  key={plan.name}
                  className={`flex flex-col rounded-2xl border bg-card p-6 sm:p-8 ${"featured" in plan && plan.featured ? "border-primary shadow-md" : "border-border"}`}
                >
                  <div className="flex min-h-7 items-center justify-between gap-3">
                    <h3 className="text-xl font-semibold">{t(plan.title)}</h3>
                    {"featured" in plan && plan.featured && (
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        {t("pricingPopular")}
                      </span>
                    )}
                  </div>
                  <p className="mt-5 text-4xl font-semibold tracking-tight tabular-nums">
                    {t(plan.price)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("pricePerMember")}</p>
                  <ul className="my-7 flex-1 space-y-3 border-t border-border pt-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-3 text-sm leading-6">
                        <span aria-hidden="true" className="text-primary">
                          ✓
                        </span>
                        <span>{t(feature)}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/sign-up"
                    className={buttonVariants({
                      variant: plan.name === "team" ? "default" : "outline",
                    })}
                  >
                    {t("pricingCta")}
                  </Link>
                </article>
              ))}
            </div>
            <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-6 text-muted-foreground">
              {t("pricingNote")}
            </p>
          </div>
        </section>

        <section
          id="privacy"
          aria-labelledby="privacy-title"
          className="mx-auto grid max-w-7xl gap-10 px-5 py-20 md:grid-cols-[1fr_0.9fr] md:items-center md:px-8 md:py-28"
        >
          <div className="space-y-4">
            <p className="text-sm font-semibold text-primary">{t("privacyEyebrow")}</p>
            <h2
              id="privacy-title"
              className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
            >
              {t("privacyTitle")}
            </h2>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">{t("privacyBody")}</p>
            <Link
              href="/security"
              className="inline-flex font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("securityLink")}{" "}
              <span aria-hidden="true" className="ml-1">
                →
              </span>
            </Link>
          </div>
          <ul className="divide-y divide-border border-y border-border">
            {PRIVACY_POINTS.map((point) => (
              <li key={point} className="flex gap-4 py-5">
                <span aria-hidden="true" className="mt-1 text-primary">
                  ✓
                </span>
                <span className="leading-7">{t(point)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="use-cases"
          aria-labelledby="use-cases-title"
          className="border-y border-border bg-muted/40"
        >
          <div className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
            <div className="max-w-2xl space-y-4">
              <p className="text-sm font-semibold text-primary">{t("useCasesEyebrow")}</p>
              <h2
                id="use-cases-title"
                className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
              >
                {t("useCasesTitle")}
              </h2>
              <p className="text-lg leading-8 text-muted-foreground">{t("useCasesBody")}</p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {USE_CASES.map((kind) => (
                <article
                  key={kind.title}
                  className="rounded-2xl border border-border bg-card p-6 sm:p-8"
                >
                  <h3 className="text-xl font-semibold">{t(kind.title)}</h3>
                  <p className="mt-3 leading-7 text-muted-foreground">{t(kind.body)}</p>
                  <p className="mt-6 border-t border-border pt-4 text-sm font-medium">
                    {t(kind.example)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="getting-started"
          aria-labelledby="start-title"
          className="mx-auto max-w-7xl scroll-mt-8 px-5 py-20 md:px-8 md:py-28"
        >
          <div className="max-w-2xl space-y-4">
            <p className="text-sm font-semibold text-primary">{t("startEyebrow")}</p>
            <h2
              id="start-title"
              className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
            >
              {t("startTitle")}
            </h2>
            <p className="text-lg leading-8 text-muted-foreground">{t("startBody")}</p>
          </div>
          <ol className="mt-10 grid gap-6 sm:grid-cols-3">
            {START_STEPS.map((step, index) => (
              <li key={step.title} className="border-t border-border pt-5">
                <p className="text-sm font-semibold tabular-nums text-primary">0{index + 1}</p>
                <h3 className="mt-3 font-semibold">{t(step.title)}</h3>
                <p className="mt-2 leading-7 text-muted-foreground">{t(step.body)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="faq"
          aria-labelledby="faq-title"
          className="scroll-mt-8 border-y border-border bg-muted/40"
        >
          <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 md:grid-cols-[0.7fr_1.3fr] md:px-8 md:py-28">
            <div className="space-y-4">
              <p className="text-sm font-semibold text-primary">{t("faqEyebrow")}</p>
              <h2 id="faq-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {t("faqTitle")}
              </h2>
              <p className="leading-7 text-muted-foreground">{t("faqBody")}</p>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {FAQ_ITEMS.map((item) => (
                <details key={item.question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                    {t(item.question)}
                    <span aria-hidden="true" className="text-primary group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">{t(item.answer)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="final-title"
          className="mx-auto max-w-7xl px-5 py-20 text-center md:px-8 md:py-28"
        >
          <div className="mx-auto max-w-2xl space-y-5">
            <h2
              id="final-title"
              className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
            >
              {t("finalTitle")}
            </h2>
            <p className="text-lg leading-8 text-muted-foreground">{t("finalBody")}</p>
            <Link href="/sign-up" className={`${buttonVariants()} h-12 px-5 text-base`}>
              {t("primaryCta")}
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
