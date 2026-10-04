import type { Id } from "@gezycbt/contracts";
import {
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import {
  QUESTION_TYPES,
  type QuestionDraftContent,
  QuestionNotFoundError,
  type QuestionType,
  QuestionValidationError,
  validateQuestionContent,
} from "./domain";
import { validateQuestionReadiness } from "./readiness";
import type {
  QuestionImportBatchInput,
  QuestionImportRepository,
} from "./repository";
import { hashQuestionContent } from "./service";

export const MAX_QUESTION_IMPORT_BYTES = 1024 * 1024;
export const MAX_QUESTION_IMPORT_ROWS = 300;
export const QUESTION_IMPORT_FORMATS = ["CSV", "TXT"] as const;
export type QuestionImportFormat = (typeof QUESTION_IMPORT_FORMATS)[number];

const QUESTION_IMPORT_HEADERS = [
  "type",
  "stimulus",
  "prompt",
  "explanation",
  ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}_correct`),
  ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}`),
  ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}_correct`),
] as const;

const QUESTION_BLOCK_MARKER = /^soal\s*\d+\s*$/iu;

export interface QuestionImportFieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface QuestionImportPreviewRow {
  readonly rowNumber: number;
  readonly type: string | null;
  readonly label: string | null;
  readonly status: "VALID" | "ERROR";
  readonly errors: readonly QuestionImportFieldError[];
}

export interface QuestionImportPreview {
  readonly sourceHash: string;
  readonly totalRows: number;
  readonly validCount: number;
  readonly errorCount: number;
  readonly rows: readonly QuestionImportPreviewRow[];
}

export interface QuestionImportInput {
  readonly questionBankId: Id;
  readonly csv: string;
  /** TXT is a tab-delimited text file (TSV), not comma-separated CSV. */
  readonly format?: QuestionImportFormat;
}

export interface CommitQuestionImportInput extends QuestionImportInput {
  readonly sourceHash: string;
}

export class QuestionImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionImportValidationError";
  }
}

interface ParsedImport {
  readonly preview: QuestionImportPreview;
  readonly drafts: readonly QuestionImportBatchInput["drafts"][number][];
}

function normalizeImportFormat(
  format: QuestionImportFormat | undefined,
): QuestionImportFormat {
  const value = format ?? "CSV";
  if (!QUESTION_IMPORT_FORMATS.includes(value)) {
    throw new QuestionImportValidationError("Format import tidak didukung.");
  }
  return value;
}

/**
 * Imports only validated draft revisions. The preview is deliberately
 * stateless: commit receives the original source file again, validates it again, and
 * atomically writes the whole batch. This keeps temporary source data out of
 * MariaDB while preventing a stale preview from committing a different file.
 */
export class QuestionImportService {
  constructor(
    private readonly repository: QuestionImportRepository,
    private readonly authorization: Pick<
      AuthorizationPolicyService,
      "assertTeacherScope"
    >,
  ) {}

  async preview(
    context: UseCaseContext,
    input: QuestionImportInput,
  ): Promise<QuestionImportPreview> {
    assertActorContext(context.actor);
    await this.assertWritableBank(context, input.questionBankId);
    return (
      await inspectQuestionSource(
        input.csv,
        normalizeImportFormat(input.format),
      )
    ).preview;
  }

  async commit(
    context: UseCaseContext,
    input: CommitQuestionImportInput,
  ): Promise<{ createdCount: number }> {
    assertMutationContext(context);
    const bank = await this.assertWritableBank(context, input.questionBankId);
    const parsed = await inspectQuestionSource(
      input.csv,
      normalizeImportFormat(input.format),
    );
    if (parsed.preview.sourceHash !== input.sourceHash) {
      throw new QuestionImportValidationError(
        "File berubah setelah preview. Buat preview baru sebelum import.",
      );
    }
    if (parsed.preview.errorCount > 0) {
      throw new QuestionImportValidationError(
        "Perbaiki semua baris error sebelum import soal.",
      );
    }
    if (!parsed.drafts.length) {
      throw new QuestionImportValidationError("File import tidak berisi soal.");
    }
    const createdBy = context.actor.userId;
    if (!createdBy) throw new QuestionNotFoundError();
    return {
      createdCount: await this.repository.createDraftBatch({
        questionBankId: bank.id,
        createdBy,
        drafts: parsed.drafts,
      }),
    };
  }

  private async assertWritableBank(
    context: UseCaseContext,
    questionBankId: Id,
  ) {
    const bank = await this.repository.findQuestionBank(questionBankId);
    if (!bank) throw new QuestionNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, bank);
    if (bank.status !== "ACTIVE") {
      throw new QuestionValidationError(
        "Archived question bank cannot receive new questions",
      );
    }
    return bank;
  }
}

async function inspectQuestionSource(
  source: string,
  format: QuestionImportFormat,
): Promise<ParsedImport> {
  const sourceHash = await sha256Hex(`${format}\u0000${source}`);
  const records = parseDelimitedRecords(source, format);
  const formatName = format === "TXT" ? "TXT" : "CSV";
  if (!records.length)
    throw new QuestionImportValidationError(`File ${formatName} kosong.`);
  const headerRecord = records[0];
  if (!headerRecord)
    throw new QuestionImportValidationError(`File ${formatName} kosong.`);
  const headers = headerRecord.map((value) => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) {
    throw new QuestionImportValidationError(
      `Header ${formatName} tidak boleh duplikat.`,
    );
  }
  for (const required of ["type", "stimulus"]) {
    if (!headers.includes(required)) {
      throw new QuestionImportValidationError(
        `Kolom wajib tidak ditemukan: ${required}.`,
      );
    }
  }
  for (const header of headers) {
    if (!QUESTION_IMPORT_HEADERS.includes(header as never)) {
      throw new QuestionImportValidationError(
        `Kolom ${formatName} tidak dikenali: ${header}. Gunakan template resmi.`,
      );
    }
  }
  const recordsToImport = records.slice(1);
  if (recordsToImport.length > MAX_QUESTION_IMPORT_ROWS) {
    throw new QuestionImportValidationError(
      `Import maksimal ${MAX_QUESTION_IMPORT_ROWS} soal per file.`,
    );
  }
  if (!recordsToImport.length) {
    throw new QuestionImportValidationError(
      `File ${formatName} belum memiliki baris soal.`,
    );
  }

  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const rows: QuestionImportPreviewRow[] = [];
  const drafts: QuestionImportBatchInput["drafts"][number][] = [];
  const seenContent = new Map<string, number>();
  for (let index = 0; index < recordsToImport.length; index += 1) {
    const values = recordsToImport[index] ?? [];
    const rowNumber = index + 2;
    const decoded = await decodeQuestionRow(values, headerIndex, rowNumber);
    const errors = [...decoded.errors];
    if (decoded.draft && errors.length === 0) {
      const digest = await hashQuestionContent(decoded.draft);
      const fingerprint = hex(digest);
      const duplicateOf = seenContent.get(fingerprint);
      if (duplicateOf !== undefined) {
        errors.push({
          field: "row",
          code: "DUPLICATE_IN_FILE",
          message: `Konten sama dengan baris ${duplicateOf}.`,
        });
      } else {
        seenContent.set(fingerprint, rowNumber);
      }
      if (!errors.length)
        drafts.push({ content: decoded.draft, contentHash: digest });
    }
    rows.push({
      rowNumber,
      type: decoded.type,
      label: decoded.label,
      status: errors.length ? "ERROR" : "VALID",
      errors,
    });
  }
  const errorCount = rows.filter((row) => row.status === "ERROR").length;
  return {
    preview: {
      sourceHash,
      totalRows: rows.length,
      validCount: rows.length - errorCount,
      errorCount,
      rows,
    },
    drafts,
  };
}

async function decodeQuestionRow(
  values: readonly string[],
  headerIndex: ReadonlyMap<string, number>,
  rowNumber: number,
): Promise<{
  readonly type: string | null;
  readonly label: string | null;
  readonly draft: QuestionDraftContent | null;
  readonly errors: readonly QuestionImportFieldError[];
}> {
  const errors: QuestionImportFieldError[] = [];
  if (values.length > headerIndex.size) {
    errors.push({
      field: "row",
      code: "TOO_MANY_COLUMNS",
      message: "Baris memiliki nilai lebih banyak daripada header.",
    });
  }
  const value = (field: string): string =>
    values[headerIndex.get(field) ?? -1]?.trim() ?? "";
  const rawType = value("type").toUpperCase();
  const type = QUESTION_TYPES.includes(rawType as QuestionType)
    ? (rawType as QuestionType)
    : null;
  if (!type) {
    errors.push({
      field: "type",
      code: "TYPE_INVALID",
      message: "Tipe harus SINGLE_CHOICE, MULTIPLE_RESPONSE, atau TRUE_FALSE.",
    });
  }
  const stimulus = value("stimulus");
  const label = stimulus ? stimulus.slice(0, 120) : null;
  if (!type) return { type: rawType || null, label, draft: null, errors };

  const optionValues = Array.from({ length: 10 }, (_, index) => ({
    position: index + 1,
    content: value(`option_${index + 1}`),
    key: value(`option_${index + 1}_correct`),
  }));
  const statementValues = Array.from({ length: 3 }, (_, index) => ({
    position: index + 1,
    content: value(`statement_${index + 1}`),
    key: value(`statement_${index + 1}_correct`),
  }));
  const hasOptions = optionValues.some((item) => item.content || item.key);
  const hasStatements = statementValues.some(
    (item) => item.content || item.key,
  );
  const options = [] as QuestionDraftContent["options"][number][];
  const statements = [] as QuestionDraftContent["statements"][number][];

  if (type === "TRUE_FALSE") {
    if (value("prompt")) {
      errors.push({
        field: "prompt",
        code: "PROMPT_FORBIDDEN",
        message: "TRUE_FALSE tidak memakai kolom prompt.",
      });
    }
    if (hasOptions) {
      errors.push({
        field: "option_1",
        code: "OPTIONS_FORBIDDEN",
        message: "TRUE_FALSE tidak memakai kolom opsi.",
      });
    }
    for (const item of statementValues) {
      if (!item.content) {
        errors.push({
          field: `statement_${item.position}`,
          code: "STATEMENT_REQUIRED",
          message: "Tiga pernyataan TRUE_FALSE wajib diisi.",
        });
      }
      const correctValue = booleanValue(
        item.key,
        `statement_${item.position}_correct`,
        errors,
      );
      if (item.content && correctValue !== null) {
        statements.push({
          position: item.position,
          statementHtml: item.content,
          correctValue,
        });
      }
    }
  } else {
    if (hasStatements) {
      errors.push({
        field: "statement_1",
        code: "STATEMENTS_FORBIDDEN",
        message: "Soal pilihan tidak memakai kolom pernyataan TRUE_FALSE.",
      });
    }
    for (const item of optionValues) {
      if (!item.content && !item.key) continue;
      if (!item.content) {
        errors.push({
          field: `option_${item.position}`,
          code: "OPTION_CONTENT_REQUIRED",
          message: "Isi opsi wajib diisi bila kunci opsi diisi.",
        });
        continue;
      }
      const isCorrect = booleanValue(
        item.key,
        `option_${item.position}_correct`,
        errors,
      );
      if (isCorrect !== null) {
        options.push({
          position: item.position,
          contentHtml: item.content,
          isCorrect,
        });
      }
    }
  }

  const draft = {
    type,
    stimulusHtml: stimulus,
    promptHtml: type === "TRUE_FALSE" ? null : value("prompt"),
    explanationHtml: value("explanation") || null,
    options,
    statements,
  } satisfies QuestionDraftContent;
  try {
    const normalized = validateQuestionContent(draft);
    const report = validateQuestionReadiness(
      `import-${rowNumber}` as Id,
      normalized,
    );
    for (const issue of report.issues) {
      if (issue.severity === "ERROR") {
        errors.push({
          field: issue.fieldPath,
          code: issue.code,
          message: issue.message,
        });
      }
    }
    return { type, label, draft: normalized, errors };
  } catch (error) {
    errors.push({
      field: "row",
      code: "CONTENT_INVALID",
      message:
        error instanceof Error ? error.message : "Isi soal tidak dapat dibaca.",
    });
    return { type, label, draft: null, errors };
  }
}

function booleanValue(
  raw: string,
  field: string,
  errors: QuestionImportFieldError[],
): boolean | null {
  const normalized = raw.trim().toUpperCase();
  if (["TRUE", "BENAR", "1"].includes(normalized)) return true;
  if (["FALSE", "SALAH", "0"].includes(normalized)) return false;
  errors.push({
    field,
    code: normalized ? "BOOLEAN_INVALID" : "BOOLEAN_REQUIRED",
    message: "Isi kunci dengan BENAR/SALAH, TRUE/FALSE, atau 1/0.",
  });
  return null;
}

function parseDelimitedRecords(
  source: string,
  format: QuestionImportFormat,
): string[][] {
  const formatName = format === "TXT" ? "TXT" : "CSV";
  if (new TextEncoder().encode(source).byteLength > MAX_QUESTION_IMPORT_BYTES) {
    throw new QuestionImportValidationError(
      `Ukuran file ${formatName} melebihi batas 1 MiB.`,
    );
  }
  const input = source.replace(/^\uFEFF/u, "");
  if (format === "TXT" && isQuestionBlockTxt(input)) {
    return parseQuestionBlockTxt(input);
  }
  const delimiter = format === "TXT" ? "\t" : ",";
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += character;
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((item) => item.length > 0)) records.push(row);
      row = [];
    } else field += character;
  }
  if (quoted) {
    throw new QuestionImportValidationError(
      `${formatName} memiliki kutip yang belum ditutup.`,
    );
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((item) => item.length > 0)) records.push(row);
  }
  return records;
}

function isQuestionBlockTxt(input: string): boolean {
  const firstContentLine = input
    .split(/\r\n|\r|\n/u)
    .find((line) => line.trim().length > 0);
  return Boolean(
    firstContentLine && QUESTION_BLOCK_MARKER.test(firstContentLine),
  );
}

function parseQuestionBlockTxt(input: string): string[][] {
  const questions: Map<string, string>[] = [];
  let question: Map<string, string> | null = null;
  const lines = input.split(/\r\n|\r|\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) continue;
    if (QUESTION_BLOCK_MARKER.test(line)) {
      if (question) questions.push(question);
      question = new Map();
      continue;
    }
    if (!question) {
      throw new QuestionImportValidationError(
        `Baris ${index + 1}: TXT harus dimulai dengan label Soal1.`,
      );
    }
    const separator = line.indexOf("\t");
    if (separator < 1) {
      throw new QuestionImportValidationError(
        `Baris ${index + 1}: gunakan tab di antara nama field dan nilainya.`,
      );
    }
    const field = line.slice(0, separator).trim().toLowerCase();
    if (!QUESTION_IMPORT_HEADERS.includes(field as never)) {
      throw new QuestionImportValidationError(
        `Baris ${index + 1}: field TXT tidak dikenali: ${field}. Gunakan template resmi.`,
      );
    }
    if (question.has(field)) {
      throw new QuestionImportValidationError(
        `Baris ${index + 1}: field TXT ${field} tidak boleh duplikat dalam satu soal.`,
      );
    }
    question.set(field, line.slice(separator + 1));
  }
  if (question) questions.push(question);
  if (!questions.length) {
    throw new QuestionImportValidationError("File TXT belum memiliki soal.");
  }
  return [
    [...QUESTION_IMPORT_HEADERS],
    ...questions.map((item) =>
      QUESTION_IMPORT_HEADERS.map((field) => item.get(field) ?? ""),
    ),
  ];
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
