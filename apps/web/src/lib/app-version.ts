const DEFAULT_APP_VERSION = "1.1.0";

// SemVer 2.0.0 core, prerelease, and build metadata grammar.
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function isSemVer(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

const configuredVersion =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : DEFAULT_APP_VERSION;

export const APP_VERSION = isSemVer(configuredVersion)
  ? configuredVersion
  : DEFAULT_APP_VERSION;
