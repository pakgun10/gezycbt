import { describe, expect, test } from "bun:test";
import {
  preserveAcademicYearSelection,
  subjectOptionLabel,
} from "./master-data-policies";
import type { AcademicYear, Subject } from "./types";

const year = (id: string, isActive = false): AcademicYear => ({
  id,
  name: id === "1" ? "2026/2027" : "2027/2028",
  startsOn: "2026-07-01",
  endsOn: "2027-06-30",
  isActive,
  updatedAt: "2026-09-18T00:00:00.000Z",
});

describe("master-data UI policies", () => {
  test("preserves the selected academic year after a class refresh", () => {
    expect(
      preserveAcademicYearSelection("2", [year("1", true), year("2")]),
    ).toBe("2");
  });

  test("falls back to active then first year when selection is unavailable", () => {
    expect(
      preserveAcademicYearSelection("missing", [year("1"), year("2", true)]),
    ).toBe("2");
    expect(
      preserveAcademicYearSelection("missing", [year("1"), year("2")]),
    ).toBe("1");
    expect(preserveAcademicYearSelection("missing", [])).toBe("");
  });

  test("shows a readable subject option label", () => {
    const subject: Subject = {
      id: "7",
      code: "MTK",
      name: "Matematika",
      status: "ACTIVE",
      updatedAt: "2026-09-18T00:00:00.000Z",
    };
    expect(subjectOptionLabel(subject)).toBe("Matematika (MTK)");
  });
});
