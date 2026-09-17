import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type {
  ExamQuestionReference,
  ExamRevision,
  ExamSummary,
} from "./domain";
import { ExamReadinessService, validateExamReadiness } from "./readiness";

const NOW = "2026-09-17T02:00:00.000Z" as UtcTimestamp;
const SUBJECT = "20" as Id;

describe("exam readiness", () => {
  test("accepts a valid published question list and computes decimal total deterministically", () => {
    const revision = withQuestions([
      question("100", 1, "1.5"),
      question("101", 2, "2.00"),
    ]);
    const report = validateExamReadiness(revision, [
      published("100"),
      published("101"),
    ]);

    expect(report.isReady).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.totalPoints).toBe("3.50");
    expect(report.questionCount).toBe(2);
  });

  test("reports no-question and missing-instruction states with stable severity", () => {
    const report = validateExamReadiness(
      { ...withQuestions([]), instructionsHtml: "" },
      [],
    );

    expect(report.isReady).toBe(false);
    expect(
      report.issues.map((issue) => `${issue.severity}:${issue.code}`),
    ).toEqual([
      "ERROR:EXAM_QUESTIONS_REQUIRED",
      "WARNING:EXAM_INSTRUCTIONS_MISSING",
    ]);
  });

  test("rejects duplicate, non-contiguous, unpublished, cross-subject, and invalid points", () => {
    const revision = withQuestions([
      question("100", 1, "0"),
      question("100", 3, "1.00"),
    ]);
    const report = validateExamReadiness(revision, [
      { ...published("100"), status: "DRAFT" },
      { ...published("100"), status: "DRAFT", subjectId: "21" as Id },
    ]);
    const codes = report.issues.map((issue) => issue.code);

    expect(report.isReady).toBe(false);
    expect(codes).toContain("EXAM_QUESTION_DUPLICATE");
    expect(codes).toContain("EXAM_QUESTION_POSITIONS_INVALID");
    expect(codes).toContain("EXAM_QUESTION_POINTS_INVALID");
    expect(codes).toContain("EXAM_QUESTION_NOT_PUBLISHED");
    expect(codes).toContain("EXAM_QUESTION_SUBJECT_MISMATCH");
    expect(codes).toContain("EXAM_PUBLISHED_QUESTION_REQUIRED");
  });

  test("loads references through the repository and returns null for an unknown revision", async () => {
    const repository = new FakeReadinessRepository();
    const service = new ExamReadinessService(repository);

    expect(await service.validateRevision("404" as Id)).toBeNull();
    const report = await service.validateRevision("40" as Id);
    expect(report?.totalPoints).toBe("2.50");
    expect(repository.lookups).toEqual(["100" as Id, "101" as Id]);
  });
});

function published(id: string): ExamQuestionReference {
  return {
    id: id as Id,
    questionId: `${id}0` as Id,
    subjectId: SUBJECT,
    ownerTeacherId: "10" as Id,
    status: "PUBLISHED",
  };
}

function question(id: string, position: number, points: string) {
  return {
    id: `${position + 500}` as Id,
    examRevisionId: "40" as Id,
    questionRevisionId: id as Id,
    position,
    points,
    createdAt: NOW,
  };
}

function withQuestions(
  questions: readonly ExamRevision["questions"][number][],
): ExamRevision {
  const exam: ExamSummary = {
    id: "30" as Id,
    subjectId: SUBJECT,
    ownerTeacherId: "10" as Id,
    status: "DRAFT",
    currentPublishedRevisionId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    id: "40" as Id,
    examId: exam.id,
    exam,
    revisionNo: 1,
    status: "DRAFT",
    title: "Ujian",
    instructionsHtml: "Kerjakan",
    durationSeconds: 3_600,
    shuffleQuestions: false,
    shuffleOptions: false,
    totalPoints: "0.00",
    publishedAt: null,
    questions,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class FakeReadinessRepository {
  readonly lookups: Id[] = [];
  private readonly revision = withQuestions([
    question("100", 1, "1.00"),
    question("101", 2, "1.5"),
  ]);

  async findRevision(id: Id): Promise<ExamRevision | null> {
    return id === "40" ? this.revision : null;
  }

  async findQuestionRevision(id: Id): Promise<ExamQuestionReference | null> {
    this.lookups.push(id);
    return published(id);
  }
}
