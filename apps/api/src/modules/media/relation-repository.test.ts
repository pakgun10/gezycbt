import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import {
  MediaAssetReferencedError,
  MediaPublishedReferenceError,
  MediaRelationImmutableError,
} from "./relation-domain";
import { SqlMediaRelationRepository } from "./relation-repository";

describe("SqlMediaRelationRepository", () => {
  test("persists upload metadata after storage has been prepared", async () => {
    const database = new FakeMediaDatabase();
    const repository = new SqlMediaRelationRepository(database);

    const result = await repository.create({
      storageKey: "media/random-key",
      originalName: "diagram.png",
      mimeType: "image/png",
      byteSize: 100,
      sha256: new Uint8Array(32),
      width: 100,
      height: 100,
      status: "READY",
      createdBy: "10" as Id,
    });

    expect(result.id).toBe("30" as Id);
    expect(
      database.statements.some((statement) =>
        statement.includes("INSERT INTO media_assets"),
      ),
    ).toBe(true);
  });

  test("attaches a validated relation to a draft revision transactionally", async () => {
    const database = new FakeMediaDatabase();
    const repository = new SqlMediaRelationRepository(database);

    const result = await repository.attach({
      questionRevisionId: "40" as Id,
      mediaAssetId: "30" as Id,
      usage: "STIMULUS",
      altText: "Diagram",
      isDecorative: false,
    });

    expect(result.altText).toBe("Diagram");
    expect(database.transactionCount).toBe(1);
    expect(
      database.statements.some((statement) =>
        statement.includes("INSERT INTO question_revision_media"),
      ),
    ).toBe(true);
  });

  test("lists relations with normalized accessibility metadata", async () => {
    const database = new FakeMediaDatabase();
    database.relationRows = [
      {
        question_revision_id: 40n,
        media_asset_id: 30n,
        usage: "STIMULUS",
        alt_text: "Diagram",
        is_decorative: 0,
      },
    ];
    const repository = new SqlMediaRelationRepository(database);

    const result = await repository.list("40" as Id);

    expect(result).toEqual([
      {
        questionRevisionId: "40" as Id,
        mediaAssetId: "30" as Id,
        usage: "STIMULUS",
        altText: "Diagram",
        isDecorative: false,
      },
    ]);
  });

  test("does not mutate a published revision", async () => {
    const database = new FakeMediaDatabase();
    database.revisionStatus = "PUBLISHED";
    const repository = new SqlMediaRelationRepository(database);

    await expect(
      repository.attach({
        questionRevisionId: "40" as Id,
        mediaAssetId: "30" as Id,
        usage: "STIMULUS",
        altText: "Diagram",
        isDecorative: false,
      }),
    ).rejects.toBeInstanceOf(MediaRelationImmutableError);
    expect(
      database.statements.some((statement) =>
        statement.includes("INSERT INTO question_revision_media"),
      ),
    ).toBe(false);
  });

  test("blocks deleting an asset referenced by a published revision", async () => {
    const database = new FakeMediaDatabase();
    database.references = [{ status: "PUBLISHED" }];
    const repository = new SqlMediaRelationRepository(database);

    await expect(repository.deleteAsset("30" as Id)).rejects.toBeInstanceOf(
      MediaPublishedReferenceError,
    );
    expect(
      database.statements.some((statement) => statement.includes("SET status")),
    ).toBe(false);
  });

  test("blocks deleting an asset referenced by a draft revision", async () => {
    const database = new FakeMediaDatabase();
    database.references = [{ status: "DRAFT" }];
    const repository = new SqlMediaRelationRepository(database);

    await expect(repository.deleteAsset("30" as Id)).rejects.toBeInstanceOf(
      MediaAssetReferencedError,
    );
  });

  test("marks an orphan asset deleted after the transaction locks it", async () => {
    const database = new FakeMediaDatabase();
    const repository = new SqlMediaRelationRepository(database);

    const result = await repository.deleteAsset("30" as Id);

    expect(result?.status).toBe("DELETED");
    expect(
      database.statements.some((statement) =>
        statement.includes("SET status = 'DELETED'"),
      ),
    ).toBe(true);
  });
});

class FakeMediaDatabase implements DatabasePort {
  readonly statements: string[] = [];
  transactionCount = 0;
  revisionStatus: "DRAFT" | "PUBLISHED" = "DRAFT";
  references: Array<{ status: "DRAFT" | "PUBLISHED" }> = [];
  relationRows: Array<Record<string, unknown>> = [];

  async query<T extends Record<string, unknown>>(
    sql: string,
  ): Promise<readonly T[]> {
    this.statements.push(sql);
    if (sql.includes("FROM media_assets"))
      return [assetRow()] as unknown as readonly T[];
    if (sql.includes("FROM question_revisions qr"))
      return [revisionRow(this.revisionStatus)] as unknown as readonly T[];
    if (sql.includes("FROM question_revision_media qrm"))
      return this.references.map((reference) => ({
        question_revision_id: 40n,
        revision_status: reference.status,
      })) as unknown as readonly T[];
    if (sql.includes("FROM question_revision_media"))
      return this.relationRows as readonly T[];
    return [] as readonly T[];
  }

  async execute(
    sql: string,
  ): Promise<{ affectedRows: number; insertId?: bigint }> {
    this.statements.push(sql);
    if (sql.includes("INSERT INTO media_assets"))
      return { affectedRows: 1, insertId: 30n };
    return { affectedRows: 1 };
  }

  async transaction<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this);
  }

  async close(): Promise<void> {}
}

function assetRow(): Record<string, unknown> {
  return {
    id: 30n,
    storage_key: "media/random-key",
    original_name: "diagram.png",
    mime_type: "image/png",
    byte_size: 100,
    sha256: new Uint8Array(32),
    width: 100,
    height: 100,
    status: "READY",
    created_by: 10n,
  };
}

function revisionRow(status: "DRAFT" | "PUBLISHED"): Record<string, unknown> {
  return {
    id: 40n,
    status,
    owner_teacher_id: 10n,
    subject_id: 20n,
    question_bank_id: 21n,
    question_bank_name: "Bank",
  };
}
