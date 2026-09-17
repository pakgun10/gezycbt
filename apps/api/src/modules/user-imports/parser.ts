import {
  type ImportFieldError,
  ImportValidationError,
  type ParsedParticipantRow,
} from "./domain";

export const MAX_IMPORT_ROWS = 1_500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export interface ParsedParticipantCsv {
  readonly rows: readonly ParsedParticipantRow[];
  readonly sourceText: string;
}

export function parseParticipantCsv(source: string): ParsedParticipantCsv {
  const bytes = new TextEncoder().encode(source).byteLength;
  if (bytes > MAX_IMPORT_BYTES) {
    throw new ImportValidationError("Import file exceeds the 2 MiB limit");
  }
  const records = parseCsvRecords(source.replace(/^\uFEFF/u, ""));
  if (!records.length) throw new ImportValidationError("Import file is empty");
  const headerRecord = records[0];
  if (!headerRecord) throw new ImportValidationError("Import file is empty");
  const headers = headerRecord.map((header) => header.trim().toLowerCase());
  const required = ["username", "display_name"];
  for (const field of required) {
    if (!headers.includes(field)) {
      throw new ImportValidationError(`Required column is missing: ${field}`);
    }
  }
  if (new Set(headers).size !== headers.length) {
    throw new ImportValidationError("Import file contains duplicate columns");
  }
  for (const header of headers) {
    if (!["username", "display_name", "class_code"].includes(header)) {
      if (
        ["password", "password_hash", "temporary_password"].includes(header)
      ) {
        throw new ImportValidationError(
          "Password columns are not accepted in import files",
        );
      }
      throw new ImportValidationError(`Unknown import column: ${header}`);
    }
  }
  const usernameIndex = headers.indexOf("username");
  const displayNameIndex = headers.indexOf("display_name");
  const classCodeIndex = headers.indexOf("class_code");
  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    throw new ImportValidationError(
      `Import file cannot contain more than ${MAX_IMPORT_ROWS} rows`,
    );
  }
  const rows: ParsedParticipantRow[] = [];
  for (let index = 0; index < dataRecords.length; index += 1) {
    const values = dataRecords[index];
    if (!values) continue;
    const errors: ImportFieldError[] = [];
    if (values.length > headers.length) {
      errors.push({
        field: "row",
        code: "TOO_MANY_COLUMNS",
        message: "Row has more values than the header",
      });
    }
    const username = values[usernameIndex]?.trim() ?? "";
    const displayName = values[displayNameIndex]?.trim() ?? "";
    const classCode =
      classCodeIndex >= 0 ? values[classCodeIndex]?.trim() || null : null;
    rows.push({
      rowNumber: index + 2,
      username,
      displayName,
      classCode,
      errors,
    });
  }
  return { rows, sourceText: source };
}

function parseCsvRecords(source: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) records.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  if (quoted)
    throw new ImportValidationError("Import CSV has an unclosed quoted field");
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.length > 0)) records.push(row);
  }
  return records;
}
