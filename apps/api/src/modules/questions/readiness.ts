import type { Id } from "@gezycbt/contracts";
import {
  QUESTION_TYPES,
  type QuestionDraftContent,
  type QuestionOptionDraft,
  type TrueFalseStatementDraft,
} from "./domain";
import type { QuestionDraftRepository } from "./repository";

export type QuestionReadinessSeverity = "ERROR" | "WARNING";

/** A stable, field-addressable finding returned by draft/publish validation. */
export interface QuestionReadinessIssue {
  readonly severity: QuestionReadinessSeverity;
  readonly code: string;
  readonly entityId: Id;
  readonly fieldPath: string;
  readonly message: string;
  readonly remediationHint?: string;
}

export interface QuestionReadinessReport {
  readonly revisionId: Id;
  readonly isReady: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly issues: readonly QuestionReadinessIssue[];
}

/** Application boundary used by validate/publish use cases. */
export class QuestionReadinessService {
  constructor(
    private readonly repository: Pick<QuestionDraftRepository, "findRevision">,
  ) {}

  async validateRevision(
    revisionId: Id,
  ): Promise<QuestionReadinessReport | null> {
    const revision = await this.repository.findRevision(revisionId);
    return revision ? validateQuestionReadiness(revision.id, revision) : null;
  }
}

/**
 * Checks publish invariants without mutating state. It intentionally accepts
 * the structural content type instead of trusting the draft write path: a
 * publish request must remain safe if data was imported or written by an
 * older application version.
 */
export function validateQuestionReadiness(
  revisionId: Id,
  content: QuestionDraftContent,
): QuestionReadinessReport {
  const issues: QuestionReadinessIssue[] = [];
  const add = (
    severity: QuestionReadinessSeverity,
    code: string,
    fieldPath: string,
    message: string,
    remediationHint: string,
    entityId = revisionId,
  ): void => {
    issues.push({
      severity,
      code,
      entityId,
      fieldPath,
      message,
      remediationHint,
    });
  };

  if (!QUESTION_TYPES.includes(content.type)) {
    add(
      "ERROR",
      "QUESTION_TYPE_INVALID",
      "type",
      "Tipe soal tidak valid.",
      "Pilih salah satu tipe soal yang tersedia.",
    );
  }

  if (!hasText(content.stimulusHtml)) {
    add(
      "ERROR",
      "QUESTION_STIMULUS_REQUIRED",
      "stimulusHtml",
      "Stimulus wajib diisi.",
      "Tambahkan stimulus soal sebelum menerbitkan revision.",
    );
  }

  if (content.type === "TRUE_FALSE") {
    validateTrueFalse(content, add, revisionId);
  } else if (
    content.type === "SINGLE_CHOICE" ||
    content.type === "MULTIPLE_RESPONSE"
  ) {
    validateChoice(content, add, revisionId);
  }

  if (!hasText(content.explanationHtml)) {
    add(
      "WARNING",
      "QUESTION_EXPLANATION_MISSING",
      "explanationHtml",
      "Pembahasan soal belum diisi.",
      "Tambahkan pembahasan agar hasil review guru lebih mudah dilakukan.",
    );
  }

  issues.sort(compareIssues);
  const errorCount = issues.filter(
    (issue) => issue.severity === "ERROR",
  ).length;
  const warningCount = issues.length - errorCount;
  return {
    revisionId,
    isReady: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
}

function validateChoice(
  content: QuestionDraftContent,
  add: AddIssue,
  revisionId: Id,
): void {
  if (!hasText(content.promptHtml)) {
    add(
      "ERROR",
      "QUESTION_PROMPT_REQUIRED",
      "promptHtml",
      "Pertanyaan wajib diisi untuk soal pilihan.",
      "Tambahkan pertanyaan setelah stimulus.",
    );
  }
  if (content.statements.length > 0) {
    add(
      "ERROR",
      "QUESTION_CHOICE_STATEMENTS_FORBIDDEN",
      "statements",
      "Soal pilihan tidak boleh memiliki pernyataan benar/salah.",
      "Hapus semua pernyataan benar/salah dari soal ini.",
    );
  }
  if (content.options.length < 2 || content.options.length > 10) {
    add(
      "ERROR",
      "QUESTION_OPTIONS_COUNT_INVALID",
      "options",
      "Soal pilihan harus memiliki 2 sampai 10 opsi.",
      "Tambahkan atau hapus opsi hingga jumlahnya berada dalam batas.",
    );
  }
  validateOptionPositions(content.options, add, revisionId);
  content.options.forEach((option, index) => {
    if (!hasText(option.contentHtml)) {
      add(
        "ERROR",
        "QUESTION_OPTION_CONTENT_REQUIRED",
        optionPath(index, "contentHtml"),
        "Isi opsi wajib diisi.",
        "Tambahkan teks atau media pada opsi ini.",
        option.id ?? revisionId,
      );
    }
  });
  const correctCount = content.options.filter(
    (option) => option.isCorrect,
  ).length;
  if (content.type === "SINGLE_CHOICE" && correctCount !== 1) {
    add(
      "ERROR",
      "QUESTION_SINGLE_CORRECT_COUNT_INVALID",
      "options",
      "SINGLE_CHOICE harus memiliki tepat satu opsi benar.",
      "Tandai tepat satu opsi sebagai jawaban benar.",
    );
  }
  if (content.type === "MULTIPLE_RESPONSE" && correctCount < 1) {
    add(
      "ERROR",
      "QUESTION_MULTIPLE_CORRECT_REQUIRED",
      "options",
      "MULTIPLE_RESPONSE harus memiliki setidaknya satu opsi benar.",
      "Tandai setidaknya satu opsi sebagai jawaban benar.",
    );
  }
}

function validateTrueFalse(
  content: QuestionDraftContent,
  add: AddIssue,
  revisionId: Id,
): void {
  if (hasText(content.promptHtml)) {
    add(
      "ERROR",
      "QUESTION_TRUE_FALSE_PROMPT_FORBIDDEN",
      "promptHtml",
      "TRUE_FALSE tidak boleh memiliki pertanyaan tambahan.",
      "Kosongkan pertanyaan tambahan dan letakkan konteks pada stimulus.",
    );
  }
  if (content.options.length > 0) {
    add(
      "ERROR",
      "QUESTION_TRUE_FALSE_OPTIONS_FORBIDDEN",
      "options",
      "TRUE_FALSE tidak boleh memiliki opsi pilihan.",
      "Hapus opsi pilihan dari soal ini.",
    );
  }
  if (content.statements.length !== 3) {
    add(
      "ERROR",
      "QUESTION_STATEMENTS_COUNT_INVALID",
      "statements",
      "TRUE_FALSE harus memiliki tepat tiga pernyataan.",
      "Tambahkan atau hapus pernyataan hingga terdapat tepat tiga.",
    );
  }
  validateStatementPositions(content.statements, add, revisionId);
  content.statements.forEach((statement, index) => {
    if (!hasText(statement.statementHtml)) {
      add(
        "ERROR",
        "QUESTION_STATEMENT_CONTENT_REQUIRED",
        statementPath(index, "statementHtml"),
        "Isi pernyataan wajib diisi.",
        "Tambahkan teks pada pernyataan ini.",
        statement.id ?? revisionId,
      );
    }
    if (typeof statement.correctValue !== "boolean") {
      add(
        "ERROR",
        "QUESTION_STATEMENT_KEY_INVALID",
        statementPath(index, "correctValue"),
        "Kunci jawaban pernyataan tidak valid.",
        "Pilih Benar atau Salah untuk pernyataan ini.",
        statement.id ?? revisionId,
      );
    }
  });
}

function validateOptionPositions(
  options: readonly QuestionOptionDraft[],
  add: AddIssue,
  revisionId: Id,
): void {
  const expected = new Set(options.map((_, index) => index + 1));
  if (
    options.some((option) => !Number.isInteger(option.position)) ||
    new Set(options.map((option) => option.position)).size !== options.length ||
    options.some((option) => !expected.has(option.position))
  ) {
    add(
      "ERROR",
      "QUESTION_OPTION_POSITIONS_INVALID",
      "options",
      "Posisi opsi harus unik dan berurutan mulai dari 1.",
      "Susun ulang opsi agar posisinya berurutan.",
      revisionId,
    );
  }
}

function validateStatementPositions(
  statements: readonly TrueFalseStatementDraft[],
  add: AddIssue,
  revisionId: Id,
): void {
  const expected = new Set([1, 2, 3]);
  if (
    statements.some((statement) => !Number.isInteger(statement.position)) ||
    new Set(statements.map((statement) => statement.position)).size !==
      statements.length ||
    statements.some((statement) => !expected.has(statement.position))
  ) {
    add(
      "ERROR",
      "QUESTION_STATEMENT_POSITIONS_INVALID",
      "statements",
      "Posisi pernyataan harus unik dan berurutan dari 1 sampai 3.",
      "Susun ulang pernyataan agar posisinya 1, 2, dan 3.",
      revisionId,
    );
  }
}

type AddIssue = (
  severity: QuestionReadinessSeverity,
  code: string,
  fieldPath: string,
  message: string,
  remediationHint: string,
  entityId?: Id,
) => void;

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionPath(index: number, field: string): string {
  return `options[${index}].${field}`;
}

function statementPath(index: number, field: string): string {
  return `statements[${index}].${field}`;
}

function compareIssues(
  left: QuestionReadinessIssue,
  right: QuestionReadinessIssue,
): number {
  const severity =
    left.severity === right.severity ? 0 : left.severity === "ERROR" ? -1 : 1;
  return (
    severity ||
    left.fieldPath.localeCompare(right.fieldPath) ||
    left.code.localeCompare(right.code) ||
    left.entityId.localeCompare(right.entityId)
  );
}
