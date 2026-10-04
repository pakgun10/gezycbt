import type { QuestionDraftContent } from "./domain";

export interface CanonicalMediaHashEntry {
  readonly placementKey: string;
  readonly mediaAssetId: string;
  readonly usage: string;
  readonly questionOptionId?: string | null;
  readonly trueFalseStatementId?: string | null;
  readonly sortOrder: number;
  readonly altText: string | null;
  readonly isDecorative: boolean;
  readonly displayWidthPercent: number;
  readonly alignment: string;
}

export function canonicalQuestionValue(
  content: QuestionDraftContent,
  media: readonly CanonicalMediaHashEntry[] = [],
): string {
  return JSON.stringify({
    type: content.type,
    stimulusHtml: content.stimulusHtml,
    promptHtml: content.promptHtml,
    explanationHtml: content.explanationHtml,
    options: [...content.options]
      .sort((a, b) => a.position - b.position)
      .map((option) => ({
        position: option.position,
        contentHtml: option.contentHtml,
        isCorrect: option.isCorrect,
      })),
    statements: [...content.statements]
      .sort((a, b) => a.position - b.position)
      .map((statement) => ({
        position: statement.position,
        statementHtml: statement.statementHtml,
        correctValue: statement.correctValue,
      })),
    media: [...media]
      .sort((a, b) =>
        a.placementKey.localeCompare(b.placementKey) ||
        a.sortOrder - b.sortOrder,
      )
      .map((item) => ({
        placementKey: item.placementKey,
        mediaAssetId: item.mediaAssetId,
        usage: item.usage,
        questionOptionId: item.questionOptionId ?? null,
        trueFalseStatementId: item.trueFalseStatementId ?? null,
        sortOrder: item.sortOrder,
        altText: item.altText,
        isDecorative: item.isDecorative,
        displayWidthPercent: item.displayWidthPercent,
        alignment: item.alignment,
      })),
  });
}

export async function hashCanonicalQuestion(
  content: QuestionDraftContent,
  media: readonly CanonicalMediaHashEntry[] = [],
): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalQuestionValue(content, media)),
  );
  return new Uint8Array(digest);
}
