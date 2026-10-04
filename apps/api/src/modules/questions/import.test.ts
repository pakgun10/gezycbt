import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import type { QuestionBankSummary } from "./domain";
import { QuestionImportService, QuestionImportValidationError } from "./import";
import type {
  QuestionImportBatchInput,
  QuestionImportRepository,
} from "./repository";

const ACTOR: UseCaseContext = {
  actor: {
    actorType: "HUMAN",
    role: "TEACHER",
    userId: "10" as Id,
    requestId: "question-import-test",
    active: true,
  },
  idempotencyKey: "question-import-idempotency-001",
};

const BANK: QuestionBankSummary = {
  id: "20" as Id,
  subjectId: "30" as Id,
  ownerTeacherId: "10" as Id,
  name: "Bank Matematika",
  status: "ACTIVE",
};

const HEADERS = [
  "type",
  "stimulus",
  "prompt",
  "explanation",
  ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}_correct`),
  ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}`),
  ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}_correct`),
];

function csv(rows: readonly Record<string, string>[]): string {
  return [
    HEADERS.join(","),
    ...rows.map((row) => HEADERS.map((header) => row[header] ?? "").join(",")),
  ].join("\n");
}

function txt(rows: readonly Record<string, string>[]): string {
  return [
    HEADERS.join("\t"),
    ...rows.map((row) => HEADERS.map((header) => row[header] ?? "").join("\t")),
  ].join("\n");
}

function txtBlocks(rows: readonly Record<string, string>[]): string {
  return rows
    .map((row, index) =>
      [
        `Soal${index + 1}`,
        ...HEADERS.map((header) => `${header}\t${row[header] ?? ""}`),
      ].join("\n"),
    )
    .join("\n\n");
}

function repository() {
  const batches: QuestionImportBatchInput[] = [];
  const value: QuestionImportRepository = {
    async findQuestionBank() {
      return BANK;
    },
    async createDraftBatch(input) {
      batches.push(input);
      return input.drafts.length;
    },
  };
  return { value, batches };
}

const authorization: Pick<AuthorizationPolicyService, "assertTeacherScope"> = {
  async assertTeacherScope() {
    return undefined;
  },
};

describe("QuestionImportService", () => {
  test("previews and atomically commits all three supported question types", async () => {
    const store = repository();
    const service = new QuestionImportService(store.value, authorization);
    const source = csv([
      {
        type: "SINGLE_CHOICE",
        stimulus: "Stimulus pilihan tunggal",
        prompt: "Pilih jawaban tepat",
        option_1: "A",
        option_1_correct: "BENAR",
        option_2: "B",
        option_2_correct: "SALAH",
      },
      {
        type: "MULTIPLE_RESPONSE",
        stimulus: "Stimulus pilihan banyak",
        prompt: "Pilih semua jawaban tepat",
        option_1: "A",
        option_1_correct: "TRUE",
        option_2: "B",
        option_2_correct: "FALSE",
        option_3: "C",
        option_3_correct: "1",
      },
      {
        type: "TRUE_FALSE",
        stimulus: "Stimulus benar salah",
        statement_1: "Pernyataan pertama",
        statement_1_correct: "BENAR",
        statement_2: "Pernyataan kedua",
        statement_2_correct: "SALAH",
        statement_3: "Pernyataan ketiga",
        statement_3_correct: "1",
      },
    ]);

    const preview = await service.preview(ACTOR, {
      questionBankId: BANK.id,
      csv: source,
    });
    expect(preview).toMatchObject({
      totalRows: 3,
      validCount: 3,
      errorCount: 0,
    });

    await expect(
      service.commit(ACTOR, {
        questionBankId: BANK.id,
        csv: source,
        sourceHash: preview.sourceHash,
      }),
    ).resolves.toEqual({ createdCount: 3 });
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0]?.drafts.map((item) => item.content.type)).toEqual([
      "SINGLE_CHOICE",
      "MULTIPLE_RESPONSE",
      "TRUE_FALSE",
    ]);
  });

  test("blocks an invalid preview and refuses a changed source file", async () => {
    const service = new QuestionImportService(
      repository().value,
      authorization,
    );
    const invalid = csv([
      {
        type: "SINGLE_CHOICE",
        stimulus: "Stimulus",
        prompt: "Pertanyaan",
        option_1: "Satu opsi saja",
        option_1_correct: "BENAR",
      },
    ]);
    const preview = await service.preview(ACTOR, {
      questionBankId: BANK.id,
      csv: invalid,
    });
    expect(preview.errorCount).toBeGreaterThan(0);
    await expect(
      service.commit(ACTOR, {
        questionBankId: BANK.id,
        csv: invalid,
        sourceHash: preview.sourceHash,
      }),
    ).rejects.toBeInstanceOf(QuestionImportValidationError);
    await expect(
      service.commit(ACTOR, {
        questionBankId: BANK.id,
        csv: invalid,
        sourceHash: "0".repeat(64),
      }),
    ).rejects.toBeInstanceOf(QuestionImportValidationError);
  });

  test("previews and commits a tab-delimited TXT import", async () => {
    const store = repository();
    const service = new QuestionImportService(store.value, authorization);
    const source = txt([
      {
        type: "SINGLE_CHOICE",
        stimulus: "Stimulus dengan koma, tetap satu kolom.",
        prompt: "Pilih jawaban tepat",
        option_1: "A",
        option_1_correct: "BENAR",
        option_2: "B",
        option_2_correct: "SALAH",
      },
    ]);

    const preview = await service.preview(ACTOR, {
      questionBankId: BANK.id,
      csv: source,
      format: "TXT",
    });
    expect(preview).toMatchObject({ totalRows: 1, validCount: 1 });
    await expect(
      service.commit(ACTOR, {
        questionBankId: BANK.id,
        csv: source,
        format: "TXT",
        sourceHash: preview.sourceHash,
      }),
    ).resolves.toEqual({ createdCount: 1 });
    await expect(
      service.commit(ACTOR, {
        questionBankId: BANK.id,
        csv: source,
        format: "CSV",
        sourceHash: preview.sourceHash,
      }),
    ).rejects.toBeInstanceOf(QuestionImportValidationError);
  });

  test("imports the readable Soal block TXT template", async () => {
    const store = repository();
    const service = new QuestionImportService(store.value, authorization);
    const source = txtBlocks([
      {
        type: "SINGLE_CHOICE",
        stimulus: "Nilai: 6, 7, 7, 8, 8, 8, 9.",
        prompt: "Berapakah modusnya?",
        explanation: "Nilai 8 paling sering muncul.",
        option_1: "6",
        option_2: "7",
        option_3: "8",
        option_4: "9",
        option_1_correct: "SALAH",
        option_2_correct: "SALAH",
        option_3_correct: "BENAR",
        option_4_correct: "SALAH",
      },
      {
        type: "MULTIPLE_RESPONSE",
        stimulus: "Data buku: 5, 6, 6, 7, 8, 8, 9.",
        prompt: "Pilih semua pernyataan yang benar.",
        option_1: "Mean data adalah 7",
        option_2: "Median data adalah 7",
        option_3: "Modus data hanya 6",
        option_4: "Modus data adalah 6 dan 8",
        option_1_correct: "BENAR",
        option_2_correct: "BENAR",
        option_3_correct: "SALAH",
        option_4_correct: "BENAR",
      },
      {
        type: "TRUE_FALSE",
        stimulus: "Berat badan: 40, 45, 45, 50, 60.",
        explanation: "Mean 48, median dan modus 45.",
        statement_1: "Rata-rata berat badan adalah 48 kg.",
        statement_2: "Median data tersebut adalah 50 kg.",
        statement_3: "Modus sama dengan mediannya.",
        statement_1_correct: "BENAR",
        statement_2_correct: "SALAH",
        statement_3_correct: "BENAR",
      },
    ]);

    const preview = await service.preview(ACTOR, {
      questionBankId: BANK.id,
      csv: source,
      format: "TXT",
    });
    expect(preview).toMatchObject({ totalRows: 3, validCount: 3 });
    await expect(
      service.commit(ACTOR, {
        questionBankId: BANK.id,
        csv: source,
        format: "TXT",
        sourceHash: preview.sourceHash,
      }),
    ).resolves.toEqual({ createdCount: 3 });
    expect(store.batches[0]?.drafts.map((item) => item.content.type)).toEqual([
      "SINGLE_CHOICE",
      "MULTIPLE_RESPONSE",
      "TRUE_FALSE",
    ]);
  });
});
