import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteFile,
  shareFile,
  unshareFile,
  uploadFile,
  setVisibility,
} from "@/features/files/server/file-service";
import { fileAccessWhere } from "@/features/files/server/file-service";
import { INGEST_JOB } from "@/features/knowledge/schemas/knowledge";
import { ingestDocument } from "@/features/knowledge/server/ingest";
import {
  listDocuments,
  removeFromKnowledge,
  requestIndexing,
  searchKnowledge,
} from "@/features/knowledge/server/knowledge-service";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { claimNextJob, enqueueJob, runJobs, STALE_AFTER_MS } from "@/server/jobs/queue";
import { createLocalStorage, type StoragePort } from "@/server/storage/storage";
import { createTestOrganization, resetDatabase } from "../helpers/db";

let dir: string;
let storage: StoragePort;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fts-knowledge-"));
  storage = createLocalStorage(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const deps = () => ({ prisma: db() });
const fileDeps = () => ({ prisma: db(), storage });
const handlers = () => ({
  [INGEST_JOB]: (job: Parameters<typeof ingestDocument>[1]) =>
    ingestDocument({ prisma: db(), storage }, job),
});
const index = () => runJobs(db(), handlers());

async function expectCode(promise: Promise<unknown>, code: AppError["code"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
  );
}

const contextFor = (slug: string, userId: string): Promise<OrganizationContext> =>
  getAuthorizedOrganization({ prisma: db() }, { userId, organizationSlug: slug });

async function setup() {
  const acme = await createTestOrganization("acme", {
    admin: "ADMIN",
    alice: "MEMBER",
    bob: "MEMBER",
    viewer: "VIEWER",
  });
  const globex = await createTestOrganization("globex");
  return {
    acme,
    owner: await contextFor("acme", acme.users.owner!.id),
    admin: await contextFor("acme", acme.users.admin!.id),
    alice: await contextFor("acme", acme.users.alice!.id),
    bob: await contextFor("acme", acme.users.bob!.id),
    viewer: await contextFor("acme", acme.users.viewer!.id),
    globexOwner: await contextFor("globex", globex.users.owner!.id),
  };
}

const NOTES =
  "The quarterly budget review covers marketing spend.\n\nZebrafish migration is scheduled for March.";

async function indexedFile(
  context: OrganizationContext,
  visibility = "PRIVATE",
  body = NOTES,
  mimeType = "text/markdown",
) {
  const file = await uploadFile(fileDeps(), context, {
    name: "notes.md",
    mimeType,
    bytes: new TextEncoder().encode(body),
    visibility,
  });
  await requestIndexing(deps(), context, file.id);
  await index();
  return file;
}

const found = async (context: OrganizationContext, q = "zebrafish") =>
  (await searchKnowledge(deps(), context, q)).map((hit) => hit.fileId);

describe("job queue", () => {
  beforeEach(resetDatabase);

  it("enqueues idempotently and claims each job once, oldest first", async () => {
    const { acme } = await setup();
    const organizationId = acme.organization.id;
    expect(await enqueueJob(db(), { organizationId, type: "t", payload: {}, dedupeKey: "k" })).toBe(
      true,
    );
    expect(await enqueueJob(db(), { organizationId, type: "t", payload: {}, dedupeKey: "k" })).toBe(
      false,
    );
    await enqueueJob(db(), { organizationId, type: "t", payload: { n: 2 } });
    const claims = await Promise.all([
      claimNextJob(db(), new Date()),
      claimNextJob(db(), new Date()),
      claimNextJob(db(), new Date()),
    ]);
    const ids = claims.flatMap((job) => (job ? [job.id] : []));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(claims.filter((job) => job === null)).toHaveLength(1);
    expect(claims.find((job) => job)?.attempts).toBe(1);
  });

  it("retries with backoff and then stops, keeping only a short error", async () => {
    const { acme } = await setup();
    await enqueueJob(db(), { organizationId: acme.organization.id, type: "flaky", payload: {} });
    const now = new Date();
    let result = await runJobs(
      db(),
      {
        flaky: async () => {
          throw new Error("x".repeat(1000));
        },
      },
      { now: () => now },
    );
    expect(result).toEqual({ done: 0, retried: 1, failed: 0 });
    const queued = await db().job.findFirstOrThrow();
    expect(queued.status).toBe("QUEUED");
    expect(queued.runAt.getTime()).toBeGreaterThan(now.getTime());
    expect(queued.lastError!.length).toBe(300);

    // Not due yet: nothing runs. Later attempts exhaust maxAttempts.
    expect((await runJobs(db(), { flaky: async () => {} }, { now: () => now })).done).toBe(0);
    let later = new Date(now.getTime() + 3_600_000);
    for (let i = 0; i < 2; i++) {
      result = await runJobs(
        db(),
        {
          flaky: async () => {
            throw new Error("nope");
          },
        },
        { now: () => later },
      );
      later = new Date(later.getTime() + 3_600_000);
    }
    expect((await db().job.findFirstOrThrow()).status).toBe("FAILED");
  });

  it("fails unknown job types permanently and requeues jobs of dead workers", async () => {
    const { acme } = await setup();
    const organizationId = acme.organization.id;
    await enqueueJob(db(), { organizationId, type: "mystery", payload: {} });
    expect(await runJobs(db(), {})).toEqual({ done: 0, retried: 0, failed: 1 });

    await enqueueJob(db(), { organizationId, type: "ok", payload: {}, dedupeKey: "stale" });
    const claimed = await claimNextJob(db(), new Date());
    expect(claimed).not.toBeNull();
    const later = new Date(Date.now() + STALE_AFTER_MS + 1000);
    expect((await runJobs(db(), { ok: async () => {} }, { now: () => later })).done).toBe(1);
  });
});

describe("knowledge base", () => {
  beforeEach(resetDatabase);

  it("indexes in the background and finds passages with the owner's file", async () => {
    const { alice } = await setup();
    const file = await uploadFile(fileDeps(), alice, {
      name: "notes.md",
      mimeType: "text/markdown",
      bytes: new TextEncoder().encode(NOTES),
      visibility: "PRIVATE",
    });
    await requestIndexing(deps(), alice, file.id);
    expect((await listDocuments(deps(), alice))[0]).toMatchObject({
      status: "PENDING",
      mine: true,
    });
    expect(await found(alice)).toEqual([]);

    expect(await index()).toEqual({ done: 1, retried: 0, failed: 0 });
    expect((await listDocuments(deps(), alice))[0]).toMatchObject({
      status: "INDEXED",
      chunkCount: 1,
    });
    const [hit] = await searchKnowledge(deps(), alice, "zebrafish");
    expect(hit).toMatchObject({ fileId: file.id, fileName: "notes.md" });
    expect(hit!.snippet).toContain("Zebrafish migration");
  });

  it("only lets the uploader index, and only text files", async () => {
    const { alice, bob } = await setup();
    const file = await uploadFile(fileDeps(), alice, {
      name: "notes.md",
      mimeType: "text/markdown",
      bytes: new TextEncoder().encode(NOTES),
      visibility: "ORGANIZATION",
    });
    await expectCode(requestIndexing(deps(), bob, file.id), "NOT_FOUND");
    const pdf = await uploadFile(fileDeps(), alice, {
      name: "a.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 hello"),
      visibility: "PRIVATE",
    });
    await expectCode(requestIndexing(deps(), alice, pdf.id), "UNPROCESSABLE");
    await expectCode(requestIndexing(deps(), alice, "nope"), "NOT_FOUND");
    expect(await db().job.count()).toBe(0);
  });

  it("is idempotent to request and allows re-indexing", async () => {
    const { alice } = await setup();
    const file = await indexedFile(alice);
    await requestIndexing(deps(), alice, file.id);
    await requestIndexing(deps(), alice, file.id);
    expect(await db().job.count({ where: { status: "QUEUED" } })).toBe(1);
    expect(await index()).toMatchObject({ done: 1 });
    expect(await db().documentChunk.count()).toBe(1);
  });

  it("removes a document and its passages", async () => {
    const { alice, bob } = await setup();
    const file = await indexedFile(alice);
    await expectCode(removeFromKnowledge(deps(), bob, file.id), "NOT_FOUND");
    await removeFromKnowledge(deps(), alice, file.id);
    expect(await found(alice)).toEqual([]);
    expect(await db().documentChunk.count()).toBe(0);
  });

  it("marks tampered or vanished files FAILED without leaking text", async () => {
    const { alice } = await setup();
    const file = await uploadFile(fileDeps(), alice, {
      name: "notes.md",
      mimeType: "text/markdown",
      bytes: new TextEncoder().encode(NOTES),
      visibility: "PRIVATE",
    });
    const { storageKey } = await db().fileObject.findUniqueOrThrow({ where: { id: file.id } });
    await storage.delete(storageKey);
    await storage.put(storageKey, new TextEncoder().encode("tampered secret text"));
    await requestIndexing(deps(), alice, file.id);
    const result = await index();
    expect(result.retried + result.failed).toBe(1);
    const document = await db().knowledgeDocument.findFirstOrThrow();
    expect(document.status).toBe("FAILED");
    expect(document.error).toBe("The stored file failed its integrity check.");
    expect(JSON.stringify(await db().job.findFirstOrThrow())).not.toContain("tampered secret");
    expect(await found(alice)).toEqual([]);
  });

  it("ignores a job whose payload points at another organization's document", async () => {
    const { alice, globexOwner } = await setup();
    const foreign = await indexedFile(globexOwner, "ORGANIZATION");
    const foreignDoc = await db().knowledgeDocument.findFirstOrThrow({
      where: { fileId: foreign.id },
    });
    await db().documentChunk.deleteMany({});
    await db().knowledgeDocument.update({
      where: { id: foreignDoc.id },
      data: { status: "PENDING", indexedAt: null },
    });
    await enqueueJob(db(), {
      organizationId: alice.organization.id,
      type: INGEST_JOB,
      payload: { documentId: foreignDoc.id },
    });
    expect(await index()).toMatchObject({ done: 1 });
    // The foreign document was not touched or indexed on behalf of the other tenant.
    expect(
      (await db().knowledgeDocument.findUniqueOrThrow({ where: { id: foreignDoc.id } })).status,
    ).toBe("PENDING");
    expect(await db().documentChunk.count()).toBe(0);
  });

  describe("access control across retrieval", () => {
    it("private passages are found only by their uploader, never by admins or others", async () => {
      const { alice, bob, owner, admin, viewer } = await setup();
      const file = await indexedFile(alice);
      expect(await found(alice)).toEqual([file.id]);
      for (const outsider of [bob, owner, admin, viewer]) {
        expect(await found(outsider)).toEqual([]);
        expect(await listDocuments(deps(), outsider)).toEqual([]);
      }
    });

    it("sharing and unsharing take effect on the very next search", async () => {
      const { alice, bob, viewer } = await setup();
      const file = await indexedFile(alice);
      await shareFile(fileDeps(), alice, file.id, bob.userId);
      expect(await found(bob)).toEqual([file.id]);
      expect(await found(viewer)).toEqual([]);
      await unshareFile(fileDeps(), alice, file.id, bob.userId);
      expect(await found(bob)).toEqual([]);
    });

    it("organization-wide visibility reaches everyone, and going private withdraws it", async () => {
      const { alice, bob, viewer, admin } = await setup();
      const file = await indexedFile(alice, "ORGANIZATION");
      for (const reader of [bob, viewer, admin]) expect(await found(reader)).toEqual([file.id]);
      await setVisibility(fileDeps(), alice, file.id, "PRIVATE");
      for (const reader of [bob, viewer, admin]) expect(await found(reader)).toEqual([]);
      expect(await found(alice)).toEqual([file.id]);
    });

    it("deleted files vanish from search even for their uploader", async () => {
      const { alice } = await setup();
      const file = await indexedFile(alice);
      await deleteFile(fileDeps(), alice, file.id);
      expect(await found(alice)).toEqual([]);
      expect(await db().documentChunk.count()).toBe(0);
    });

    it("the search predicate agrees with the file access rule for every combination", async () => {
      const { alice, bob, admin, acme } = await setup();
      const files = [];
      for (const [i, visibility] of (["PRIVATE", "SHARED", "ORGANIZATION"] as const).entries()) {
        const file = await indexedFile(alice, "PRIVATE", `${NOTES}\n\nparity marker ${i}`);
        await db().fileObject.update({ where: { id: file.id }, data: { visibility } });
        files.push(file);
      }
      await db().fileShare.create({
        data: { organizationId: acme.organization.id, fileId: files[1]!.id, userId: bob.userId },
      });
      for (const reader of [alice, bob, admin]) {
        const allowed = (
          await db().fileObject.findMany({ where: fileAccessWhere(reader), select: { id: true } })
        ).map((f) => f.id);
        expect((await found(reader, "parity")).sort()).toEqual([...allowed].sort());
      }
    });

    it("never crosses organizations, even for organization-visible files", async () => {
      const { alice, globexOwner } = await setup();
      await indexedFile(globexOwner, "ORGANIZATION");
      expect(await found(alice)).toEqual([]);
      expect(await listDocuments(deps(), alice)).toEqual([]);
      expect(await found(globexOwner)).toHaveLength(1);
    });
  });

  it("treats query text as data: operators and SQL fragments are harmless", async () => {
    const { alice } = await setup();
    await indexedFile(alice);
    for (const q of [
      "'; DROP TABLE files; --",
      "zebrafish & !budget | (",
      '"unterminated',
      "%%__",
      "zebrafish -migration",
    ]) {
      await expect(searchKnowledge(deps(), alice, q)).resolves.toBeInstanceOf(Array);
    }
    expect(await db().fileObject.count()).toBe(1);
    await expectCode(searchKnowledge(deps(), alice, "a"), "INVALID_INPUT");
    await expectCode(searchKnowledge(deps(), alice, 42), "INVALID_INPUT");
  });
});
