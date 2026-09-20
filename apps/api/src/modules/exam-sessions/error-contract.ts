import { AppError } from "../../http/app-error";
import { ExamSessionError, FINALIZATION_REASONS } from "./domain";

/** Maps runtime failures to the stable participant-facing HTTP contract. */
export function toParticipantRuntimeError(error: unknown): AppError | null {
  if (!(error instanceof ExamSessionError)) return null;
  const status = error.status === 404 ? 404 : error.status;
  const message = participantMessage(error.code);
  const details: Record<string, unknown> = {};
  for (const key of [
    "sessionId",
    "sessionQuestionId",
    "version",
    "retryAfterSeconds",
  ] as const) {
    if (error.details[key] !== undefined) details[key] = error.details[key];
  }
  const reason = error.details.finalizationReason;
  if (
    typeof reason === "string" &&
    (FINALIZATION_REASONS as readonly string[]).includes(reason)
  )
    details.finalizationReason = safeFinalizationReason(
      reason as (typeof FINALIZATION_REASONS)[number],
    );
  return new AppError(status, error.code, message, details);
}

export function safeFinalizationReason(
  reason: (typeof FINALIZATION_REASONS)[number],
): string {
  if (reason === "STAFF_END") return "Diakhiri Petugas";
  if (reason === "SCHEDULE_CLOSE") return "Jadwal Ditutup";
  if (reason === "RESET_ATTEMPT") return "Attempt Direset";
  if (reason === "DEADLINE") return "Waktu Habis";
  return "Sudah Dikumpulkan";
}

function participantMessage(code: string): string {
  switch (code) {
    case "SCHEDULE_NOT_AVAILABLE":
      return "Ujian belum tersedia.";
    case "ATTEMPT_LIMIT_REACHED":
      return "Batas percobaan ujian sudah tercapai.";
    case "SESSION_ALREADY_ACTIVE":
      return "Ujian masih memiliki sesi aktif. Membuka kembali sesi tersebut.";
    case "SESSION_EXPIRED":
    case "DEADLINE_REACHED":
      return "Waktu ujian telah habis.";
    case "SESSION_SUBMITTED":
      return "Ujian sudah dikumpulkan.";
    case "SESSION_ENDED":
      return "Sesi ujian telah diakhiri.";
    case "ANSWER_VERSION_CONFLICT":
      return "Jawaban berubah di perangkat lain.";
    case "INVALID_ANSWER_SHAPE":
      return "Format jawaban tidak valid.";
    case "PRACTICE_ACCESS_INVALID":
      return "Token latihan atau jadwal tidak valid.";
    case "AUTH_SESSION_EXPIRED":
      return "Sesi login berakhir.";
    case "AUTHENTICATION_REQUIRED":
      return "Silakan masuk untuk melanjutkan.";
    case "RATE_LIMITED":
      return "Terlalu banyak permintaan. Coba lagi nanti.";
    case "SERVICE_BUSY":
      return "Server sedang sibuk. Coba lagi.";
    case "RESULT_NOT_RELEASED":
      return "Hasil ujian belum dirilis.";
    case "TIME_EXTENSION_INVALID":
      return "Perpanjangan waktu tidak valid.";
    default:
      return "Permintaan ujian tidak dapat diproses.";
  }
}
