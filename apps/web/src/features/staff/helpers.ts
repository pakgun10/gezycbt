import { ApiClientError } from "../../lib/api";

export function messageFrom(
  error: unknown,
  fallback = "Permintaan tidak dapat diproses.",
): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function requestIdFrom(error: unknown): string {
  return error instanceof ApiClientError ? (error.requestId ?? "") : "";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(parsed);
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeZone: "Asia/Jakarta",
  }).format(parsed);
}

export function safeHtmlPreview(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 140);
}
