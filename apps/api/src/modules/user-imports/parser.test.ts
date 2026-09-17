import { describe, expect, test } from "bun:test";
import { ImportValidationError } from "./domain";
import { MAX_IMPORT_ROWS, parseParticipantCsv } from "./parser";

describe("parseParticipantCsv", () => {
  test("parses quoted values and preserves source row numbers", () => {
    const result = parseParticipantCsv(
      'username,display_name,class_code\nparticipant-1,"Siswa, Satu",x-a\n',
    );

    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        username: "participant-1",
        displayName: "Siswa, Satu",
        classCode: "x-a",
        errors: [],
      },
    ]);
  });

  test("rejects unknown and password-bearing columns", () => {
    expect(() =>
      parseParticipantCsv("username,display_name,password\na,A,secret\n"),
    ).toThrow("Password columns are not accepted");
    expect(() =>
      parseParticipantCsv("username,display_name,email\na,A,a@example.test\n"),
    ).toThrow("Unknown import column: email");
  });

  test("records malformed row width as a blocking row error", () => {
    const result = parseParticipantCsv("username,display_name\na,A,extra\n");
    expect(result.rows[0]?.errors).toEqual([
      {
        field: "row",
        code: "TOO_MANY_COLUMNS",
        message: "Row has more values than the header",
      },
    ]);
  });

  test("enforces the bounded participant import size", () => {
    const rows = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, index) => `participant-${index},Participant ${index}`,
    ).join("\n");
    expect(() =>
      parseParticipantCsv(`username,display_name\n${rows}\n`),
    ).toThrow(ImportValidationError);
  });
});
