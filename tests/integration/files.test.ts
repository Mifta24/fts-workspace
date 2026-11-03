import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deleteFile,
  getFile,
  listFiles,
  listShares,
  readFileContent,
  setVisibility,
  shareFile,
  unshareFile,
  uploadFile,
} from "@/features/files/server/file-service";
import { MAX_FILE_BYTES } from "@/features/files/schemas/file";
import {
  getAuthorizedOrganization,
  type OrganizationContext,
} from "@/features/organizations/server/organization-service";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createClamdScanner } from "@/server/security/malware-scan";
import { createLocalStorage, type StoragePort } from "@/server/storage/storage";
import { FAKE_VIRUS, startFakeClamd, type FakeClamd } from "../helpers/fake-clamd";
import { createTestOrganization, resetDatabase } from "../helpers/db";

let dir: string;
let storage: StoragePort;
const deps = () => ({ prisma: db(), storage });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fts-files-"));
  storage = createLocalStorage(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

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

const note = (body = "meeting notes") => ({
  name: "notes.txt",
  mimeType: "text/plain",
  bytes: new TextEncoder().encode(body),
  visibility: "PRIVATE",
});

describe("files", () => {
  beforeEach(resetDatabase);

  it("uploads with a server-generated key, a checksum and an audit event", async () => {
    const { alice, acme } = await setup();
    const file = await uploadFile(deps(), alice, {
      ...note("hello"),
      name: "../../evil/notes.txt",
    });
    expect(file).toMatchObject({
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      visibility: "PRIVATE",
      mine: true,
    });
    const row = await db().fileObject.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.organizationId).toBe(acme.organization.id);
    expect(row.storageKey).toMatch(new RegExp(`^${acme.organization.id}/[0-9a-f-]{36}$`));
    expect(row.sha256).toBe(createHash("sha256").update("hello").digest("hex"));
    expect(
      await db().auditLog.count({ where: { action: "file.uploaded", resourceId: file.id } }),
    ).toBe(1);
    const { bytes } = await readFileContent(deps(), alice, file.id);
    expect(new TextDecoder().decode(bytes)).toBe("hello");
  });

  it("rejects bad content, empty files, oversize files and viewers", async () => {
    const { alice, viewer } = await setup();
    await expectCode(
      uploadFile(deps(), alice, { ...note(), mimeType: "text/html" }),
      "UNPROCESSABLE",
    );
    await expectCode(
      uploadFile(deps(), alice, { ...note(), mimeType: "application/pdf" }),
      "UNPROCESSABLE",
    );
    await expectCode(
      uploadFile(deps(), alice, { ...note(""), bytes: new Uint8Array() }),
      "INVALID_INPUT",
    );
    await expectCode(
      uploadFile(deps(), alice, { ...note(), bytes: new Uint8Array(MAX_FILE_BYTES + 1).fill(97) }),
      "UNPROCESSABLE",
    );
    await expectCode(
      uploadFile(deps(), alice, { ...note(), visibility: "SHARED" }),
      "INVALID_INPUT",
    );
    await expectCode(uploadFile(deps(), viewer, note()), "FORBIDDEN");
    expect(await db().fileObject.count()).toBe(0);
  });

  it("enforces the per-workspace storage quota", async () => {
    const { alice, acme } = await setup();
    await db().fileObject.create({
      data: {
        organizationId: acme.organization.id,
        uploadedById: acme.users.alice!.id,
        name: "big.txt",
        mimeType: "text/plain",
        sizeBytes: MAX_FILE_BYTES,
        sha256: "0".repeat(64),
        storageKey: `${acme.organization.id}/${crypto.randomUUID()}`,
      },
    });
    for (let i = 0; i < 19; i++) {
      await db().fileObject.create({
        data: {
          organizationId: acme.organization.id,
          uploadedById: acme.users.alice!.id,
          name: `big${i}.txt`,
          mimeType: "text/plain",
          sizeBytes: MAX_FILE_BYTES,
          sha256: "0".repeat(64),
          storageKey: `${acme.organization.id}/${crypto.randomUUID()}`,
        },
      });
    }
    await expectCode(uploadFile(deps(), alice, note("one more")), "UNPROCESSABLE");
  });

  describe("access rule", () => {
    it("private files are visible to the uploader only, including admins being excluded", async () => {
      const { alice, bob, owner, admin, viewer } = await setup();
      const file = await uploadFile(deps(), alice, note());
      for (const outsider of [bob, owner, admin, viewer]) {
        await expectCode(getFile(deps(), outsider, file.id), "NOT_FOUND");
        await expectCode(readFileContent(deps(), outsider, file.id), "NOT_FOUND");
        expect(await listFiles(deps(), outsider)).toEqual([]);
      }
      expect((await listFiles(deps(), alice)).map((f) => f.id)).toEqual([file.id]);
    });

    it("organization files are readable by everyone, including viewers", async () => {
      const { alice, viewer, bob } = await setup();
      const file = await uploadFile(deps(), alice, { ...note(), visibility: "ORGANIZATION" });
      for (const reader of [bob, viewer]) {
        expect((await getFile(deps(), reader, file.id)).mine).toBe(false);
        expect(
          new TextDecoder().decode((await readFileContent(deps(), reader, file.id)).bytes),
        ).toBe("meeting notes");
      }
    });

    it("sharing grants exactly the chosen people, and unsharing removes access immediately", async () => {
      const { alice, bob, viewer, admin } = await setup();
      const file = await uploadFile(deps(), alice, note());
      await shareFile(deps(), alice, file.id, bob.userId);
      expect((await getFile(deps(), alice, file.id)).visibility).toBe("SHARED");
      expect((await listShares(deps(), alice, file.id)).map((s) => s.userId)).toEqual([bob.userId]);
      await expect(getFile(deps(), bob, file.id)).resolves.toBeDefined();
      await expectCode(getFile(deps(), viewer, file.id), "NOT_FOUND");
      await expectCode(getFile(deps(), admin, file.id), "NOT_FOUND");

      await unshareFile(deps(), alice, file.id, bob.userId);
      await expectCode(getFile(deps(), bob, file.id), "NOT_FOUND");
    });

    it("only the uploader changes visibility or shares, and only with active members", async () => {
      const { alice, bob, acme, globexOwner } = await setup();
      const file = await uploadFile(deps(), alice, { ...note(), visibility: "ORGANIZATION" });
      await expectCode(setVisibility(deps(), bob, file.id, "PRIVATE"), "NOT_FOUND");
      await expectCode(shareFile(deps(), bob, file.id, bob.userId), "NOT_FOUND");
      await expectCode(shareFile(deps(), alice, file.id, globexOwner.userId), "UNPROCESSABLE");
      await expectCode(shareFile(deps(), alice, file.id, alice.userId), "INVALID_INPUT");
      await db().member.update({
        where: {
          organizationId_userId: { organizationId: acme.organization.id, userId: bob.userId },
        },
        data: { status: "DISABLED" },
      });
      await expectCode(shareFile(deps(), alice, file.id, bob.userId), "UNPROCESSABLE");
      await setVisibility(deps(), alice, file.id, "PRIVATE");
      expect((await getFile(deps(), alice, file.id)).visibility).toBe("PRIVATE");
      await expectCode(setVisibility(deps(), alice, file.id, "EVERYONE"), "INVALID_INPUT");
    });
  });

  describe("deletion", () => {
    it("removes the bytes, keeps the audit trail and hides the file", async () => {
      const { alice } = await setup();
      const file = await uploadFile(deps(), alice, note());
      const { storageKey } = await db().fileObject.findUniqueOrThrow({ where: { id: file.id } });
      await deleteFile(deps(), alice, file.id);
      expect(await storage.get(storageKey)).toBeNull();
      expect(await db().fileObject.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
        status: "DELETED",
      });
      await expectCode(getFile(deps(), alice, file.id), "NOT_FOUND");
      await expectCode(deleteFile(deps(), alice, file.id), "NOT_FOUND");
      expect(await db().auditLog.count({ where: { action: "file.deleted" } })).toBe(1);
    });

    it("lets admins delete any file without being able to read private ones; others cannot", async () => {
      const { alice, bob, admin } = await setup();
      const file = await uploadFile(deps(), alice, { ...note(), visibility: "ORGANIZATION" });
      await expectCode(deleteFile(deps(), bob, file.id), "NOT_FOUND");
      const priv = await uploadFile(deps(), alice, note("secret"));
      await expectCode(getFile(deps(), admin, priv.id), "NOT_FOUND");
      await deleteFile(deps(), admin, priv.id);
      const audit = await db().auditLog.findFirstOrThrow({
        where: { resourceId: priv.id, action: "file.deleted" },
      });
      expect(audit.metadata).toMatchObject({ moderated: true });
    });
  });

  it("detects stored bytes that no longer match their checksum", async () => {
    const { alice } = await setup();
    const file = await uploadFile(deps(), alice, note("original"));
    const { storageKey } = await db().fileObject.findUniqueOrThrow({ where: { id: file.id } });
    await storage.delete(storageKey);
    await storage.put(storageKey, new TextEncoder().encode("tampered"));
    await expectCode(readFileContent(deps(), alice, file.id), "UNPROCESSABLE");
  });

  describe("tenant isolation", () => {
    it("never exposes another organization's files, even organization-wide ones", async () => {
      const { alice, globexOwner } = await setup();
      const foreign = await uploadFile(deps(), globexOwner, {
        ...note("globex data"),
        visibility: "ORGANIZATION",
      });
      expect(await listFiles(deps(), alice)).toEqual([]);
      await expectCode(getFile(deps(), alice, foreign.id), "NOT_FOUND");
      await expectCode(readFileContent(deps(), alice, foreign.id), "NOT_FOUND");
      await expectCode(deleteFile(deps(), alice, foreign.id), "NOT_FOUND");
      await expectCode(setVisibility(deps(), alice, foreign.id, "PRIVATE"), "NOT_FOUND");
      await expectCode(getFile(deps(), alice, "not-a-uuid"), "NOT_FOUND");
      expect((await db().fileObject.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe(
        "READY",
      );
    });

    it("rejects cross-tenant shares at the database level", async () => {
      const { alice, acme, globexOwner } = await setup();
      const foreign = await uploadFile(deps(), globexOwner, note());
      await expect(
        db().fileShare.create({
          data: { organizationId: acme.organization.id, fileId: foreign.id, userId: alice.userId },
        }),
      ).rejects.toThrow();
    });
  });
});

describe("virus scan on upload", () => {
  beforeEach(resetDatabase);
  let clamd: FakeClamd | undefined;
  afterEach(async () => {
    await clamd?.close();
    clamd = undefined;
  });

  const scanning = async (required: boolean, mode: "normal" | "error" = "normal") => {
    clamd = await startFakeClamd(mode);
    return {
      ...deps(),
      scan: { scanner: createClamdScanner({ host: "127.0.0.1", port: clamd.port }), required },
    };
  };
  const stored = async (organizationId: string) => ({
    rows: await db().fileObject.count({ where: { organizationId } }),
    onDisk: (await readdir(path.join(dir, organizationId)).catch(() => [])).length,
  });

  it("stores a clean file as before", async () => {
    const { alice } = await setup();
    const file = await uploadFile(await scanning(true), alice, note("fine"));
    expect(file.sizeBytes).toBe(4);
  });

  it("refuses an infected file: no row, no bytes, an audit event without the file name", async () => {
    const { alice, acme } = await setup();
    await expectCode(
      uploadFile(await scanning(false), alice, {
        ...note(`text ${FAKE_VIRUS}`),
        name: "secret-plans.txt",
      }),
      "UNPROCESSABLE",
    );
    expect(await stored(acme.organization.id)).toEqual({ rows: 0, onDisk: 0 });
    const event = await db().auditLog.findFirstOrThrow({
      where: { organizationId: acme.organization.id, action: "file.rejected_malware" },
    });
    expect(event.actorId).toBe(alice.userId);
    expect(event.metadata).toEqual({
      signature: "Fake.Test.Virus",
      sizeBytes: 5 + FAKE_VIRUS.length,
    });
    expect(JSON.stringify(event.metadata)).not.toContain("secret-plans");
  });

  it("when scanning is required, a file that cannot be scanned is refused", async () => {
    const { alice, acme } = await setup();
    await expectCode(uploadFile(await scanning(true, "error"), alice, note()), "UNPROCESSABLE");
    expect(await stored(acme.organization.id)).toEqual({ rows: 0, onDisk: 0 });
    expect(
      await db().auditLog.count({
        where: { organizationId: acme.organization.id, action: "file.scan_unavailable" },
      }),
    ).toBe(1);
  });

  it("when scanning is optional, a file that cannot be scanned is stored and the gap is audited", async () => {
    const { alice, acme } = await setup();
    await uploadFile(await scanning(false, "error"), alice, note());
    expect((await stored(acme.organization.id)).rows).toBe(1);
    expect(
      await db().auditLog.count({
        where: { organizationId: acme.organization.id, action: "file.scan_unavailable" },
      }),
    ).toBe(1);
  });

  it("an infected file is refused even when scanning is optional", async () => {
    const { alice } = await setup();
    await expectCode(uploadFile(await scanning(false), alice, note(FAKE_VIRUS)), "UNPROCESSABLE");
  });
});
