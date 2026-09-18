import type { AcademicYear, Subject } from "./types";

/** Keep a user's academic-year context when master data is refreshed. */
export function preserveAcademicYearSelection(
  currentId: string,
  years: readonly AcademicYear[],
): string {
  if (currentId && years.some((year) => year.id === currentId))
    return currentId;
  return years.find((year) => year.isActive)?.id ?? years[0]?.id ?? "";
}

export function subjectOptionLabel(subject: Subject): string {
  return `${subject.name} (${subject.code})`;
}
