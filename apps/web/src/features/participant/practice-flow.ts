import type { PracticeIdentityField, PracticeResolveResponse } from "./types";

let resolved: PracticeResolveResponse["data"] | null = null;
let token = "";
let identityFields: readonly PracticeIdentityField[] = [];

export function setPracticeFlow(
  value: PracticeResolveResponse["data"],
  rawToken: string,
): void {
  resolved = value;
  token = rawToken;
  identityFields = value.identityFields ?? [
    { key: "name", label: "Nama", type: "TEXT", required: true },
  ];
}

export function getPracticeFlow(): {
  readonly schedule: PracticeResolveResponse["data"] | null;
  readonly token: string;
  readonly identityFields: readonly PracticeIdentityField[];
} {
  return { schedule: resolved, token, identityFields };
}

export function clearPracticeFlow(): void {
  resolved = null;
  token = "";
  identityFields = [];
}
