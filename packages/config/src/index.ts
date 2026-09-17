export type AppEnvironment = "development" | "test" | "staging" | "production";

export interface AppConfig {
  readonly appEnv: AppEnvironment;
  readonly appRelease: string;
  readonly appOrigin: URL;
  /** Optional for in-memory tests; required by staging and production. */
  readonly databaseUrl?: string;
  /** HMAC key for five-character schedule access codes. */
  readonly accessCodeHmacSecret?: string;
  /** Protected media root; never exposed through the static web handler. */
  readonly mediaRoot?: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel: "debug" | "info" | "warn" | "error";
}

export type Environment = Readonly<Record<string, string | undefined>>;

const environments = new Set<AppEnvironment>([
  "development",
  "test",
  "staging",
  "production",
]);
const levels = new Set<AppConfig["logLevel"]>([
  "debug",
  "info",
  "warn",
  "error",
]);

export function loadAppConfig(env: Environment): AppConfig {
  const appEnv = env.APP_ENV as AppEnvironment | undefined;
  if (!appEnv || !environments.has(appEnv))
    throw new Error("APP_ENV is invalid");
  const appRelease = required(env, "APP_RELEASE");
  const origin = new URL(required(env, "APP_ORIGIN"));
  if (appEnv === "production" && origin.protocol !== "https:") {
    throw new Error("APP_ORIGIN must use HTTPS in production");
  }
  const databaseUrl = env.GEZYCBT_DATABASE_URL ?? env.DATABASE_URL;
  if ((appEnv === "staging" || appEnv === "production") && !databaseUrl) {
    throw new Error("GEZYCBT_DATABASE_URL is required in staging/production");
  }
  if (databaseUrl !== undefined) validateDatabaseUrl(databaseUrl);
  const accessCodeHmacSecret = env.GEZYCBT_ACCESS_CODE_HMAC_SECRET;
  if (
    appEnv === "production" &&
    (!accessCodeHmacSecret || accessCodeHmacSecret.length < 32)
  )
    throw new Error(
      "GEZYCBT_ACCESS_CODE_HMAC_SECRET must be at least 32 characters in production",
    );
  const host = required(env, "HOST");
  const port = positiveInteger(required(env, "PORT"), "PORT");
  const logLevel = env.LOG_LEVEL ?? "info";
  if (!levels.has(logLevel as AppConfig["logLevel"]))
    throw new Error("LOG_LEVEL is invalid");
  return {
    appEnv,
    appRelease,
    appOrigin: origin,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(accessCodeHmacSecret === undefined ? {} : { accessCodeHmacSecret }),
    ...(env.GEZYCBT_MEDIA_ROOT
      ? { mediaRoot: env.GEZYCBT_MEDIA_ROOT.trim() }
      : {}),
    host,
    port,
    logLevel: logLevel as AppConfig["logLevel"],
  };
}

function validateDatabaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GEZYCBT_DATABASE_URL is invalid");
  }
  if (
    !["mariadb:", "mysql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length <= 1 ||
    !url.username
  ) {
    throw new Error("GEZYCBT_DATABASE_URL is invalid");
  }
}

function required(env: Environment, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function positiveInteger(value: string, key: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error(`${key} is invalid`);
  return parsed;
}
