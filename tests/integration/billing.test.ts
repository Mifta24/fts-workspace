import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOperationsSnapshot,
  listWorkspaces,
  resolveOperator,
  setWorkspacePlan,
  setWorkspaceSuspended,
  STUCK_JOB_MS,
  type Operator,
} from "@/features/admin/server/admin-service";
import { PLANS } from "@/features/billing/schemas/plans";
import { getBillingOverview } from "@/features/billing/server/billing-service";
import { getEntitlements } from "@/features/billing/server/entitlements";
import { createBookingPage, setBookingPageStatus } from "@/features/booking/server/booking-service";
import { createContact } from "@/features/crm/server/crm-service";
import { MAX_FILE_BYTES } from "@/features/files/schemas/file";
import { uploadFile } from "@/features/files/server/file-service";
import {
  createForm,
  getPublicForm,
  setFormStatus,
  submitPublicForm,
} from "@/features/forms/server/forms-service";
import {
  acceptInvitation,
  createInvitation,
  revokeInvitation,
} from "@/features/organizations/server/invitation-service";
import {
  createOrganization,
  getAuthorizedOrganization,
  listUserOrganizations,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { TextProvider } from "@/server/ai/provider";
import { getAiUsage, runMeteredCompletion } from "@/server/ai/usage";
import { runJobs } from "@/server/jobs/queue";
import { createLocalStorage, type StoragePort } from "@/server/storage/storage";
import { createTestOrganization, createTestUser, resetDatabase } from "../helpers/db";

const deps = () => ({ prisma: db() });
const OPTIONS = { baseUrl: "http://localhost:3000", locale: "en" };
const DAY = 86_400_000;

let dir: string;
let storage: StoragePort;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fts-billing-"));
  storage = createLocalStorage(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization(deps(), { userId, organizationSlug: slug });

const setPlan = (organizationId: string, planKey: "FREE" | "TEAM" | "BUSINESS") =>
  db().subscription.upsert({
    where: { organizationId },
    create: { organizationId, planKey, status: "ACTIVE" },
    update: { planKey, status: "ACTIVE", trialEndsAt: null },
  });

async function setup() {
  const acme = await createTestOrganization("acme", {
    admin: "ADMIN",
    manager: "MANAGER",
    alice: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    globex,
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    manager: await contextFor("acme", acme.users.manager!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const operatorUser = async () => {
  const user = await createTestUser("operator");
  return resolveOperator(user, [user.email])!;
};

describe("entitlements", () => {
  beforeEach(resetDatabase);

  it("leaves workspaces without a subscription unmetered", async () => {
    const { acme, owner } = await setup();
    expect((await getEntitlements(db(), acme.organization.id)).plan).toBe("UNMETERED");
    const overview = await getBillingOverview(deps(), owner);
    expect(overview).toMatchObject({ plan: "UNMETERED", seats: { limit: null } });
    // No seat limit applies: far more invitations than any plan's seats succeed.
    for (let i = 0; i < PLANS.FREE.seats + 2; i++) {
      await createInvitation(
        deps(),
        owner,
        { email: `p${i}@example.test`, role: "MEMBER" },
        OPTIONS,
      );
    }
  });

  it("starts a trial on creation only when asked, and ends it on time", async () => {
    const user = await createTestUser("founder");
    const plain = await createOrganization(deps(), user.id, { name: "Plain", slug: "plain" });
    expect(await db().subscription.count({ where: { organizationId: plain.id } })).toBe(0);

    const trial = await createOrganization(
      deps(),
      user.id,
      { name: "Trial", slug: "trial" },
      { trialDays: 14 },
    );
    const now = new Date();
    expect(await getEntitlements(db(), trial.id, now)).toMatchObject({
      plan: "TEAM",
      trialExpired: false,
    });
    const later = new Date(now.getTime() + 15 * DAY);
    expect(await getEntitlements(db(), trial.id, later)).toMatchObject({
      plan: "FREE",
      trialExpired: true,
    });
  });

  it("keeps one workspace's plan out of another's entitlements", async () => {
    const { acme, globex } = await setup();
    await setPlan(acme.organization.id, "BUSINESS");
    expect((await getEntitlements(db(), acme.organization.id)).plan).toBe("BUSINESS");
    expect((await getEntitlements(db(), globex.organization.id)).plan).toBe("UNMETERED");
  });

  it("shows the plan page only to owners and admins, with the caller's own figures", async () => {
    const { acme, globex, owner, admin, manager, alice, globexOwner } = await setup();
    await setPlan(acme.organization.id, "FREE");
    await setPlan(globex.organization.id, "TEAM");
    for (const context of [manager, alice]) {
      await expectCode(getBillingOverview(deps(), context), "FORBIDDEN");
    }
    const mine = await getBillingOverview(deps(), admin);
    expect(mine).toMatchObject({
      plan: "FREE",
      seats: { members: 5, pendingInvitations: 0, limit: PLANS.FREE.seats },
      features: { ai: true, crm: false, publicPages: false },
    });
    expect(await getBillingOverview(deps(), owner)).toEqual(mine);
    expect(await getBillingOverview(deps(), globexOwner)).toMatchObject({
      plan: "TEAM",
      seats: { members: 1 },
      features: { crm: true },
    });
  });
});

describe("seats", () => {
  beforeEach(resetDatabase);

  it("counts members and pending invitations against the plan, and frees a seat on revoke", async () => {
    const { acme, owner } = await setup();
    await setPlan(acme.organization.id, "FREE"); // 5 seats, 5 members
    await expectCode(
      createInvitation(deps(), owner, { email: "x@example.test", role: "MEMBER" }, OPTIONS),
      "PLAN_LIMIT",
    );

    await db().member.update({
      where: {
        organizationId_userId: {
          organizationId: acme.organization.id,
          userId: acme.users.viewer!.id,
        },
      },
      data: { status: "DISABLED" },
    });
    const invitation = await createInvitation(
      deps(),
      owner,
      { email: "x@example.test", role: "MEMBER" },
      OPTIONS,
    );
    await expectCode(
      createInvitation(deps(), owner, { email: "y@example.test", role: "MEMBER" }, OPTIONS),
      "PLAN_LIMIT",
    );
    await revokeInvitation(deps(), owner, invitation.id);
    await createInvitation(deps(), owner, { email: "y@example.test", role: "MEMBER" }, OPTIONS);
  });

  it("cannot be passed by concurrent invitations", async () => {
    const { acme, owner } = await setup();
    await setPlan(acme.organization.id, "FREE");
    await db().member.updateMany({
      where: { organizationId: acme.organization.id, role: { in: ["VIEWER", "MEMBER"] } },
      data: { status: "DISABLED" },
    }); // 3 active, 2 seats left
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        createInvitation(deps(), owner, { email: `c${i}@example.test`, role: "MEMBER" }, OPTIONS),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await db().invitation.count({ where: { organizationId: acme.organization.id } })).toBe(
      2,
    );
  });

  it("refuses to accept when the workspace shrank below its members", async () => {
    const { acme, owner } = await setup();
    await createInvitation(deps(), owner, { email: "late@example.test", role: "MEMBER" }, OPTIONS);
    const invitation = await db().invitation.findFirstOrThrow({
      where: { organizationId: acme.organization.id },
    });
    expect(invitation).toBeTruthy();
    const late = await db().user.create({
      data: { name: "Late", email: "late@example.test", emailVerified: true },
    });
    // The plan shrinks to FREE (5 seats) while 5 people are already active.
    await setPlan(acme.organization.id, "FREE");
    const token = randomBytes(32).toString("base64url");
    await db().invitation.update({
      where: { id: invitation.id },
      data: { tokenHash: createHash("sha256").update(token).digest("hex") },
    });
    await expectCode(acceptInvitation(deps(), late, token), "PLAN_LIMIT");
    expect(await db().member.count({ where: { userId: late.id } })).toBe(0);
    // The failed attempt rolled back, so the invitation can still be used once a seat frees up.
    expect(
      (await db().invitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedAt,
    ).toBeNull();
  });
});

describe("storage", () => {
  beforeEach(resetDatabase);

  /** Rows of at most MAX_FILE_BYTES, which is what the database allows per file. */
  async function fill(organizationId: string, userId: string, bytes: number) {
    const sizes: number[] = [];
    for (let left = bytes; left > 0; left -= MAX_FILE_BYTES)
      sizes.push(Math.min(left, MAX_FILE_BYTES));
    await db().fileObject.createMany({
      data: sizes.map((sizeBytes) => ({
        organizationId,
        uploadedById: userId,
        name: "fill.txt",
        mimeType: "text/plain",
        sizeBytes,
        sha256: "0".repeat(64),
        storageKey: `${organizationId}/${crypto.randomUUID()}`,
      })),
    });
  }
  const note = {
    name: "n.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("hello"),
    visibility: "PRIVATE",
  };

  it("uses the plan's storage, and reports a plan limit once it is full", async () => {
    const { acme, alice } = await setup();
    await setPlan(acme.organization.id, "FREE");
    await fill(acme.organization.id, acme.users.alice!.id, PLANS.FREE.storageBytes - 3);
    await expectCode(uploadFile({ ...deps(), storage }, alice, note), "PLAN_LIMIT");

    await setPlan(acme.organization.id, "TEAM");
    await expect(uploadFile({ ...deps(), storage }, alice, note)).resolves.toMatchObject({
      name: "n.txt",
    });
  });
});

describe("AI allowance", () => {
  beforeEach(resetDatabase);

  const provider: TextProvider = {
    name: "fake.local",
    model: "fake-1",
    complete: async () => "ok",
    generate: vi.fn(async () => ({ text: "ok", usage: { inputTokens: 10, outputTokens: 5 } })),
  };
  const run = (context: OrganizationContext, now?: Date) =>
    runMeteredCompletion(
      deps(),
      context,
      "KNOWLEDGE_ANSWER",
      provider,
      { system: "s", user: "u" },
      now,
    );
  const spend = (organizationId: string, userId: string, tokens: number, createdAt: Date) =>
    db().aiUsageEvent.create({
      data: {
        organizationId,
        userId,
        feature: "KNOWLEDGE_ANSWER",
        provider: "fake.local",
        model: "fake-1",
        status: "OK",
        tokens,
        latencyMs: 1,
        createdAt,
      },
    });

  it("lets the plan lower the daily budget but never raise the admin's setting", async () => {
    const { acme, alice, owner } = await setup();
    const now = new Date("2026-11-15T12:00:00Z");
    await setPlan(acme.organization.id, "FREE");
    expect((await getAiUsage(db(), alice, now)).dailyBudget).toBe(PLANS.FREE.aiDailyTokens);

    await db().organization.update({
      where: { id: acme.organization.id },
      data: { aiDailyTokenBudget: 1_000 },
    });
    expect((await getAiUsage(db(), alice, now)).dailyBudget).toBe(1_000);

    await db().organization.update({
      where: { id: acme.organization.id },
      data: { aiDailyTokenBudget: 200_000 },
    });
    await spend(acme.organization.id, owner.userId, PLANS.FREE.aiDailyTokens, now);
    await expectCode(run(alice, now), "RATE_LIMITED");
  });

  it("stops at the monthly allowance with a plan limit and resets next month", async () => {
    const { acme, alice, owner } = await setup();
    const now = new Date("2026-11-30T12:00:00Z");
    await setPlan(acme.organization.id, "FREE");
    // Spread over earlier days so the daily budget is not what stops it.
    for (const day of [1, 5, 10, 15, 20, 25, 28, 29, 29, 29]) {
      await spend(
        acme.organization.id,
        owner.userId,
        PLANS.FREE.aiMonthlyTokens / 10,
        new Date(`2026-11-${String(day).padStart(2, "0")}T08:00:00Z`),
      );
    }
    await expectCode(run(alice, now), "PLAN_LIMIT");
    const december = new Date("2026-12-01T00:30:00Z");
    await expect(run(alice, december)).resolves.toBe("ok");
  });
});

describe("feature entitlements", () => {
  beforeEach(resetDatabase);

  const FIELDS = { name: "Dana", email: "dana@visitor.test", message: "Hi", company: "V Inc" };
  const bookingSettings = {
    title: "Intro",
    description: "",
    location: "https://meet.example.test/a",
    durationMinutes: 60,
    timeZone: "UTC",
    weekdays: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "12:00",
    minNoticeHours: 4,
    maxDaysAhead: 7,
    consentText: "I agree to be contacted.",
  };

  it("blocks creating CRM records and publishing public pages on a plan without them", async () => {
    const { acme, manager } = await setup();
    await setPlan(acme.organization.id, "FREE");
    await expectCode(createContact(deps(), manager, { name: "Carl" }), "PLAN_LIMIT");

    const form = await createForm(deps(), manager, {
      templateId: "contact_request",
      title: "Contact",
    });
    await expectCode(setFormStatus(deps(), manager, form.id, "PUBLISHED"), "PLAN_LIMIT");
    const page = await createBookingPage(deps(), manager, bookingSettings);
    await expectCode(setBookingPageStatus(deps(), manager, page.id, "PUBLISHED"), "PLAN_LIMIT");

    await setPlan(acme.organization.id, "TEAM");
    await createContact(deps(), manager, { name: "Carl" });
    await setFormStatus(deps(), manager, form.id, "PUBLISHED");
    await setBookingPageStatus(deps(), manager, page.id, "PUBLISHED");
  });

  it("stops anonymous answers when the plan drops public pages, and keeps the data", async () => {
    const { acme, manager } = await setup();
    await setPlan(acme.organization.id, "TEAM");
    const created = await createForm(deps(), manager, {
      templateId: "contact_request",
      title: "Contact",
    });
    await setFormStatus(deps(), manager, created.id, "PUBLISHED");
    const token = (await db().form.findUniqueOrThrow({ where: { id: created.id } })).publicToken;
    await submitPublicForm(deps(), token, FIELDS, true);

    await setPlan(acme.organization.id, "FREE");
    await expectCode(getPublicForm(deps(), token), "NOT_FOUND");
    await expectCode(submitPublicForm(deps(), token, FIELDS, true), "NOT_FOUND");
    // Downgrading deleted nothing.
    expect(
      await db().formSubmission.count({ where: { organizationId: acme.organization.id } }),
    ).toBe(1);
    expect(await db().crmContact.count({ where: { organizationId: acme.organization.id } })).toBe(
      1,
    );

    await setPlan(acme.organization.id, "BUSINESS");
    await expect(getPublicForm(deps(), token)).resolves.toMatchObject({ title: "Contact" });
  });
});

describe("operator", () => {
  beforeEach(resetDatabase);

  it("recognises only verified, listed emails", async () => {
    const user = await createTestUser("ops");
    const allow = [user.email.toLowerCase()];
    expect(resolveOperator(user, allow)).toMatchObject({ userId: user.id });
    expect(resolveOperator({ ...user, email: user.email.toUpperCase() }, allow)).not.toBeNull();
    expect(resolveOperator({ ...user, emailVerified: false }, allow)).toBeNull();
    expect(resolveOperator(user, [])).toBeNull();
    expect(resolveOperator(user, ["someone@else.test"])).toBeNull();
    expect(resolveOperator(null, allow)).toBeNull();
  });

  it("sets plans and trials, audits the change and is idempotent", async () => {
    const { acme } = await setup();
    const operator = await operatorUser();
    const now = new Date("2026-11-10T10:00:00Z");
    const organizationId = acme.organization.id;

    await setWorkspacePlan(deps(), operator, { organizationId, plan: "TEAM", trialDays: "7" }, now);
    expect(await db().subscription.findUniqueOrThrow({ where: { organizationId } })).toMatchObject({
      planKey: "TEAM",
      status: "TRIALING",
      trialEndsAt: new Date(now.getTime() + 7 * DAY),
    });
    await setWorkspacePlan(deps(), operator, { organizationId, plan: "BUSINESS" }, now);
    await setWorkspacePlan(deps(), operator, { organizationId, plan: "BUSINESS" }, now);
    expect(await db().subscription.findUniqueOrThrow({ where: { organizationId } })).toMatchObject({
      planKey: "BUSINESS",
      status: "ACTIVE",
      trialEndsAt: null,
    });
    await setWorkspacePlan(deps(), operator, { organizationId, plan: "UNMETERED" }, now);
    expect(await db().subscription.count({ where: { organizationId } })).toBe(0);

    const audit = await db().auditLog.findMany({
      where: { action: "billing.plan_changed", organizationId },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((row) => row.metadata)).toEqual([
      { from: "UNMETERED", to: "TEAM/TRIALING", trialDays: 7 },
      { from: "TEAM/TRIALING", to: "BUSINESS/ACTIVE" },
      { from: "BUSINESS/ACTIVE", to: "BUSINESS/ACTIVE" },
      { from: "BUSINESS/ACTIVE", to: "UNMETERED" },
    ]);
    expect(audit.every((row) => row.actorId === operator.userId)).toBe(true);
  });

  it("rejects bad input and unknown workspaces", async () => {
    const { acme } = await setup();
    const operator = await operatorUser();
    const organizationId = acme.organization.id;
    for (const input of [
      { organizationId: "nope", plan: "TEAM" },
      { organizationId, plan: "GOLD" },
      { organizationId, plan: "TEAM", trialDays: "0" },
      { organizationId, plan: "TEAM", trialDays: "400" },
      { organizationId, plan: "UNMETERED", trialDays: "5" },
      null,
    ]) {
      await expectCode(setWorkspacePlan(deps(), operator, input), "INVALID_INPUT");
    }
    await expectCode(
      setWorkspacePlan(deps(), operator, { organizationId: crypto.randomUUID(), plan: "TEAM" }),
      "NOT_FOUND",
    );
    expect(await db().subscription.count()).toBe(0);
  });

  it("suspends and restores a workspace without deleting anything", async () => {
    const { acme, globex, alice, globexOwner, manager } = await setup();
    const operator = await operatorUser();
    await setPlan(acme.organization.id, "TEAM");
    const form = await createForm(deps(), manager, {
      templateId: "contact_request",
      title: "Contact",
    });
    await setFormStatus(deps(), manager, form.id, "PUBLISHED");
    const token = (await db().form.findUniqueOrThrow({ where: { id: form.id } })).publicToken;

    await setWorkspaceSuspended(deps(), operator, {
      organizationId: acme.organization.id,
      suspended: true,
    });
    await expectCode(contextFor("acme", acme.users.alice!.id), "NOT_FOUND");
    expect(await listUserOrganizations(deps(), acme.users.alice!.id)).toEqual([]);
    await expectCode(getPublicForm(deps(), token), "NOT_FOUND");
    // Nobody can join it through an invitation sent before the suspension.
    const inviteToken = randomBytes(32).toString("base64url");
    await db().invitation.create({
      data: {
        organizationId: acme.organization.id,
        email: "late@example.test",
        role: "MEMBER",
        tokenHash: createHash("sha256").update(inviteToken).digest("hex"),
        invitedById: acme.users.owner!.id,
        expiresAt: new Date(Date.now() + DAY),
      },
    });
    const late = await db().user.create({
      data: { name: "Late", email: "late@example.test", emailVerified: true },
    });
    await expectCode(acceptInvitation(deps(), late, inviteToken), "NOT_FOUND");
    // Other workspaces are untouched.
    expect(await listUserOrganizations(deps(), globex.users.owner!.id)).toHaveLength(1);
    expect(globexOwner.organization.slug).toBe("globex");
    expect(alice.organization.slug).toBe("acme");
    expect(await db().form.count({ where: { organizationId: acme.organization.id } })).toBe(1);

    // Its queued jobs wait instead of running, and do not count as a backlog.
    const queued = await db().job.create({
      data: { organizationId: acme.organization.id, type: "t", payload: {}, runAt: new Date(0) },
    });
    const ran: string[] = [];
    await runJobs(db(), { t: async (job) => void ran.push(job.id) });
    expect(ran).toEqual([]);
    expect((await getOperationsSnapshot(deps(), operator)).jobs).toMatchObject({
      queued: 0,
      oldestDueSeconds: null,
    });

    // Repeating changes nothing and adds no second audit row.
    await setWorkspaceSuspended(deps(), operator, {
      organizationId: acme.organization.id,
      suspended: true,
    });
    await setWorkspaceSuspended(deps(), operator, {
      organizationId: acme.organization.id,
      suspended: false,
    });
    await expect(contextFor("acme", acme.users.alice!.id)).resolves.toMatchObject({
      role: "MEMBER",
    });
    await expect(getPublicForm(deps(), token)).resolves.toMatchObject({ title: "Contact" });
    await runJobs(db(), { t: async (job) => void ran.push(job.id) });
    expect(ran).toEqual([queued.id]);
    expect(
      (
        await db().auditLog.findMany({
          where: { organizationId: acme.organization.id, resourceType: "organization" },
          select: { action: true },
          orderBy: { createdAt: "asc" },
        })
      )
        .map((row) => row.action)
        .filter((action) => action.includes("suspended")),
    ).toEqual(["organization.suspended", "organization.unsuspended"]);
  });

  it("lists workspaces with counts only, filtered by name or URL", async () => {
    const { acme } = await setup();
    const operator = await operatorUser();
    const now = new Date("2026-11-10T10:00:00Z");
    await setPlan(acme.organization.id, "TEAM");
    await db().aiUsageEvent.create({
      data: {
        organizationId: acme.organization.id,
        userId: acme.users.alice!.id,
        feature: "TASK_PLAN",
        provider: "p",
        model: "m",
        status: "OK",
        tokens: 123,
        latencyMs: 1,
        createdAt: new Date("2026-11-02T00:00:00Z"),
      },
    });
    const all = await listWorkspaces(deps(), operator, "", now);
    expect(all.map((row) => row.slug).sort()).toEqual(["acme", "globex"]);
    expect(all.find((row) => row.slug === "acme")).toMatchObject({
      plan: "TEAM",
      members: 5,
      aiTokensThisMonth: 123,
      suspended: false,
    });
    expect((await listWorkspaces(deps(), operator, "GLOB", now)).map((row) => row.slug)).toEqual([
      "globex",
    ]);
    expect(Object.keys(all[0]!).sort()).toEqual(
      [
        "aiTokensThisMonth",
        "createdAt",
        "id",
        "members",
        "name",
        "plan",
        "slug",
        "suspended",
        "trialEndsAt",
        "trialExpired",
      ].sort(),
    );
    await expectCode(listWorkspaces(deps(), operator, "x".repeat(200)), "INVALID_INPUT");
  });

  it("reports platform health as counts", async () => {
    const { acme } = await setup();
    const operator: Operator = await operatorUser();
    const now = new Date("2026-11-10T10:00:00Z");
    const job = (status: "QUEUED" | "RUNNING" | "FAILED", extra: Record<string, unknown>) =>
      db().job.create({
        data: { organizationId: acme.organization.id, type: "t", payload: {}, status, ...extra },
      });
    await job("QUEUED", { runAt: new Date(now.getTime() - 90_000) });
    await job("QUEUED", { runAt: new Date(now.getTime() + 3_600_000) });
    await job("FAILED", { finishedAt: new Date(now.getTime() - 3_600_000) });
    await job("FAILED", { finishedAt: new Date(now.getTime() - 3 * DAY) });
    await job("RUNNING", { lockedAt: new Date(now.getTime() - STUCK_JOB_MS - 1_000) });
    await job("RUNNING", { lockedAt: new Date(now.getTime() - 60_000) });

    const snapshot = await getOperationsSnapshot(deps(), operator, now);
    expect(snapshot.workspaces).toBe(2);
    expect(snapshot.jobs).toEqual({ queued: 2, oldestDueSeconds: 90, failedLast24h: 1, stuck: 1 });
    expect(snapshot.ai).toEqual({ callsLast24h: 0, errorsLast24h: 0 });
  });
});
