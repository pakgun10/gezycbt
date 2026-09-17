import type { Id } from "@gezycbt/contracts";
import {
  type ExamQuestionReference,
  type ExamRevision,
  normalizePoints,
} from "./domain";
import type { ExamDraftRepository } from "./repository";

export type ExamReadinessSeverity = "ERROR" | "WARNING";

export interface ExamReadinessIssue {
  readonly severity: ExamReadinessSeverity;
  readonly code: string;
  readonly entityId: Id;
  readonly fieldPath: string;
  readonly message: string;
  readonly remediationHint?: string;
}

export interface ExamReadinessReport {
  readonly revisionId: Id;
  readonly isReady: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly questionCount: number;
  readonly totalPoints: string;
  readonly issues: readonly ExamReadinessIssue[];
}

export class ExamReadinessService {
  constructor(
    private readonly repository: Pick<
      ExamDraftRepository,
      "findRevision" | "findQuestionRevision"
    >,
  ) {}

  async validateRevision(revisionId: Id): Promise<ExamReadinessReport | null> {
    const revision = await this.repository.findRevision(revisionId);
    if (!revision) return null;
    const references = await Promise.all(
      revision.questions.map((question) =>
        this.repository.findQuestionRevision(question.questionRevisionId),
      ),
    );
    return validateExamReadiness(revision, references);
  }
}

/** Pure readiness check used by both validation and publish paths. */
export function validateExamReadiness(
  revision: ExamRevision,
  references: readonly (ExamQuestionReference | null | undefined)[],
): ExamReadinessReport {
  const issues: ExamReadinessIssue[] = [];
  const add = (
    severity: ExamReadinessSeverity,
    code: string,
    entityId: Id,
    fieldPath: string,
    message: string,
    remediationHint: string,
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

  if (!hasText(revision.title)) {
    add(
      "ERROR",
      "EXAM_TITLE_REQUIRED",
      revision.id,
      "title",
      "Judul ujian wajib diisi.",
      "Tambahkan judul sebelum menerbitkan revision.",
    );
  } else if (revision.title.trim().length > 250) {
    add(
      "ERROR",
      "EXAM_TITLE_TOO_LONG",
      revision.id,
      "title",
      "Judul ujian terlalu panjang.",
      "Gunakan judul maksimal 250 karakter.",
    );
  }

  if (
    !Number.isSafeInteger(revision.durationSeconds) ||
    revision.durationSeconds < 1 ||
    revision.durationSeconds > 86_400
  ) {
    add(
      "ERROR",
      "EXAM_DURATION_INVALID",
      revision.id,
      "durationSeconds",
      "Durasi ujian tidak valid.",
      "Tetapkan durasi antara 1 detik dan 24 jam.",
    );
  }

  if (!hasText(revision.instructionsHtml)) {
    add(
      "WARNING",
      "EXAM_INSTRUCTIONS_MISSING",
      revision.id,
      "instructionsHtml",
      "Instruksi ujian belum diisi.",
      "Tambahkan instruksi agar peserta memahami aturan pengerjaan.",
    );
  }

  if (revision.questions.length === 0) {
    add(
      "ERROR",
      "EXAM_QUESTIONS_REQUIRED",
      revision.id,
      "questions",
      "Ujian harus memiliki minimal satu soal.",
      "Tambahkan minimal satu published question revision.",
    );
  }

  const seenPositions = new Set<number>();
  const seenQuestions = new Set<Id>();
  let hasPositionError = false;
  let publishedCount = 0;
  const pointValues: string[] = [];

  revision.questions.forEach((question, index) => {
    const fieldPath = `questions[${index}]`;
    const entityId = validId(question.questionRevisionId)
      ? question.questionRevisionId
      : revision.id;
    if (
      !Number.isSafeInteger(question.position) ||
      question.position < 1 ||
      question.position !== index + 1 ||
      seenPositions.has(question.position)
    ) {
      hasPositionError = true;
    }
    seenPositions.add(question.position);

    if (validId(question.questionRevisionId)) {
      if (seenQuestions.has(question.questionRevisionId)) {
        add(
          "ERROR",
          "EXAM_QUESTION_DUPLICATE",
          entityId,
          `${fieldPath}.questionRevisionId`,
          "Revision soal tidak boleh dipilih dua kali.",
          "Hapus duplikasi dari daftar soal.",
        );
      }
      seenQuestions.add(question.questionRevisionId);
    } else {
      add(
        "ERROR",
        "EXAM_QUESTION_ID_INVALID",
        revision.id,
        `${fieldPath}.questionRevisionId`,
        "Referensi revision soal tidak valid.",
        "Pilih ulang soal dari question picker.",
      );
    }

    const points = safePoints(question.points);
    if (!points) {
      add(
        "ERROR",
        "EXAM_QUESTION_POINTS_INVALID",
        entityId,
        `${fieldPath}.points`,
        "Bobot soal harus lebih besar dari nol.",
        "Tetapkan bobot decimal maksimal dua angka di belakang koma.",
      );
    } else {
      pointValues.push(points);
    }

    const reference = references[index];
    if (!reference) {
      add(
        "ERROR",
        "EXAM_QUESTION_NOT_FOUND",
        entityId,
        `${fieldPath}.questionRevisionId`,
        "Revision soal tidak ditemukan.",
        "Pilih ulang soal yang masih tersedia.",
      );
    } else {
      if (reference.status !== "PUBLISHED") {
        add(
          "ERROR",
          "EXAM_QUESTION_NOT_PUBLISHED",
          entityId,
          `${fieldPath}.questionRevisionId`,
          "Semua soal ujian harus sudah diterbitkan.",
          "Publish question revision terlebih dahulu.",
        );
      } else {
        publishedCount += 1;
      }
      if (reference.subjectId !== revision.exam.subjectId) {
        add(
          "ERROR",
          "EXAM_QUESTION_SUBJECT_MISMATCH",
          entityId,
          `${fieldPath}.questionRevisionId`,
          "Subject soal harus sama dengan subject ujian.",
          "Pilih soal dari subject ujian yang sama.",
        );
      }
    }
  });

  if (hasPositionError) {
    add(
      "ERROR",
      "EXAM_QUESTION_POSITIONS_INVALID",
      revision.id,
      "questions",
      "Posisi soal harus unik dan berurutan mulai dari 1.",
      "Susun ulang soal agar posisinya berurutan.",
    );
  }
  if (revision.questions.length > 0 && publishedCount === 0) {
    add(
      "ERROR",
      "EXAM_PUBLISHED_QUESTION_REQUIRED",
      revision.id,
      "questions",
      "Minimal satu published question revision diperlukan.",
      "Publish soal lalu tambahkan ke ujian.",
    );
  }

  issues.sort(compareIssues);
  const errorCount = issues.filter(
    (issue) => issue.severity === "ERROR",
  ).length;
  const warningCount = issues.length - errorCount;
  return {
    revisionId: revision.id,
    isReady: errorCount === 0,
    errorCount,
    warningCount,
    questionCount: revision.questions.length,
    totalPoints: sumPoints(pointValues),
    issues,
  };
}

function safePoints(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return normalizePoints(value);
  } catch {
    return null;
  }
}

function sumPoints(values: readonly string[]): string {
  const cents = values.reduce(
    (total, value) => total + BigInt(value.replace(".", "")),
    0n,
  );
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validId(value: unknown): value is Id {
  return typeof value === "string" && /^\d+$/u.test(value);
}

function compareIssues(
  left: ExamReadinessIssue,
  right: ExamReadinessIssue,
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
