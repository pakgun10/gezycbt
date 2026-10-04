import type { Id } from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import { internalMediaRedirect } from "./protected-serving";

export interface ParticipantMediaAccess {
  readonly participantId?: Id;
  readonly practiceCredential?: Uint8Array;
}

export interface AuthorizedParticipantMedia {
  readonly id: Id;
  readonly storageKey: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly internalRedirect: string;
}

/** Authorizes an image through the immutable session manifest before serving. */
export class ParticipantMediaService {
  constructor(private readonly database: DatabasePort) {}

  async authorize(
    mediaAssetId: Id,
    access: ParticipantMediaAccess,
  ): Promise<AuthorizedParticipantMedia | null> {
    const rows = await this.database.query<Record<string, unknown>>(
      `SELECT ma.id, ma.storage_key, ma.mime_type
       FROM media_assets ma
       WHERE ma.id = ? AND ma.status = 'READY'
         AND (
           EXISTS (
             SELECT 1
             FROM question_media_placements p
             JOIN exam_session_questions esq
               ON esq.question_revision_id = p.question_revision_id
             JOIN exam_sessions es ON es.id = esq.session_id
             WHERE p.media_asset_id = ma.id
               AND p.\`usage\` IN ('STIMULUS', 'PROMPT', 'OPTION', 'STATEMENT')
               AND (
                 (? IS NOT NULL AND es.participant_id = ?)
                 OR
                 (? IS NOT NULL AND es.participant_id IS NULL
                  AND es.practice_session_credential_hash = ?)
               )
           )
           OR EXISTS (
             SELECT 1
             FROM question_revision_media legacy
             JOIN exam_session_questions esq
               ON esq.question_revision_id = legacy.question_revision_id
             JOIN exam_sessions es ON es.id = esq.session_id
             WHERE legacy.media_asset_id = ma.id
               AND legacy.\`usage\` IN ('STIMULUS', 'PROMPT', 'OPTION', 'STATEMENT')
               AND (
                 (? IS NOT NULL AND es.participant_id = ?)
                 OR
                 (? IS NOT NULL AND es.participant_id IS NULL
                  AND es.practice_session_credential_hash = ?)
               )
           )
         )
      LIMIT 1`,
      [
        mediaAssetId,
        access.participantId ?? null,
        access.participantId ?? null,
        access.practiceCredential ?? null,
        access.practiceCredential ?? null,
        access.participantId ?? null,
        access.participantId ?? null,
        access.practiceCredential ?? null,
        access.practiceCredential ?? null,
      ],
    );
    const row = rows[0];
    if (!row) return null;
    if (
      row.mime_type !== "image/jpeg" &&
      row.mime_type !== "image/png" &&
      row.mime_type !== "image/webp"
    )
      return null;
    const id = typeof row.id === "bigint" ? row.id.toString() : String(row.id);
    if (!/^\d+$/u.test(id) || typeof row.storage_key !== "string") return null;
    return {
      id: id as Id,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      internalRedirect: internalMediaRedirect(row.storage_key),
    };
  }
}
