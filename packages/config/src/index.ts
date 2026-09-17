export type AppEnvironment = "development" | "test" | "staging" | "production";

export interface AppConfig {
  readonly appEnv: AppEnvironment;
  readonly appRelease: string;
  readonly appOrigin: URL;
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
  const host = required(env, "HOST");
  const port = positiveInteger(required(env, "PORT"), "PORT");
  const logLevel = env.LOG_LEVEL ?? "info";
  if (!levels.has(logLevel as AppConfig["logLevel"]))
    throw new Error("LOG_LEVEL is invalid");
  return {
    appEnv,
    appRelease,
    appOrigin: origin,
    host,
    port,
    logLevel: logLevel as AppConfig["logLevel"],
  };
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
