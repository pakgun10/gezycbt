import { createBunSqlDatabase } from "@gezycbt/database";
import { PasswordService, validatePassword } from "../modules/auth";
import {
  normalizeUsername,
  SqlUserRepository,
  UserConflictError,
  type UserRepository,
  UserValidationError,
  type UserView,
  validateDisplayName,
} from "../modules/users";

export interface BootstrapAdminInput {
  readonly username: string;
  readonly displayName: string;
  readonly password: string;
}

export interface BootstrapAuditEvent {
  readonly event: "ADMIN_BOOTSTRAP_COMPLETED";
  readonly requestId: string;
  readonly userId: string;
  readonly username: string;
}

export interface BootstrapAuditPort {
  record(event: BootstrapAuditEvent): Promise<void>;
}

export type PasswordHasher = (
  password: string,
  usernameNormalized?: string,
) => Promise<string>;

export class AdminBootstrapService {
  constructor(
    private readonly repository: UserRepository,
    private readonly audit: BootstrapAuditPort,
    private readonly hashPassword: PasswordHasher = defaultHashPassword,
  ) {}

  async run(input: BootstrapAdminInput): Promise<UserView> {
    const usernameNormalized = normalizeUsername(input.username);
    const username = input.username.normalize("NFKC").trim();
    const displayName = validateDisplayName(input.displayName);
    validateBootstrapPassword(input.password, usernameNormalized);
    const passwordHash = await this.hashPassword(
      input.password,
      usernameNormalized,
    );
    if (!passwordHash.startsWith("$argon2")) {
      throw new UserValidationError(
        "Password hasher must return an Argon2 PHC string",
      );
    }
    const user = await this.repository.createFirstAdmin({
      username,
      displayName,
      role: "ADMIN",
      passwordHash,
      forcePasswordChange: true,
    });
    const requestId = crypto.randomUUID();
    await this.audit.record({
      event: "ADMIN_BOOTSTRAP_COMPLETED",
      requestId,
      userId: user.id,
      username: user.username,
    });
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      displayName: user.displayName,
      forcePasswordChange: user.forcePasswordChange,
      passwordChangedAt: user.passwordChangedAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

export function validateBootstrapPassword(
  password: string,
  usernameNormalized: string,
): void {
  try {
    validatePassword(password, "ADMIN", usernameNormalized);
  } catch (error) {
    if (error instanceof UserValidationError) {
      throw new UserValidationError(
        error.message.replace(/^Staff password/u, "Bootstrap password"),
      );
    }
    throw error;
  }
}

export interface BootstrapCliArguments {
  readonly username: string;
  readonly displayName: string;
}

export function parseBootstrapCliArguments(
  argv: readonly string[],
): BootstrapCliArguments {
  let username: string | undefined;
  let displayName: string | undefined;
  let passwordStdin = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--username") username = argv[++index];
    else if (argument === "--display-name") displayName = argv[++index];
    else if (argument === "--password-stdin") passwordStdin = true;
    else
      throw new UserValidationError(`Unknown bootstrap argument: ${argument}`);
  }
  if (!username || !displayName || !passwordStdin) {
    throw new UserValidationError(
      "Usage: bootstrap:admin --username <value> --display-name <value> --password-stdin",
    );
  }
  return { username, displayName };
}

const defaultPasswordService = new PasswordService();

async function defaultHashPassword(
  password: string,
  usernameNormalized = "",
): Promise<string> {
  return defaultPasswordService.hash(password, "ADMIN", usernameNormalized);
}

const consoleAudit: BootstrapAuditPort = {
  async record(event) {
    console.error(JSON.stringify({ ...event, actorType: "SYSTEM" }));
  },
};

async function main(): Promise<void> {
  const args = parseBootstrapCliArguments(Bun.argv.slice(2));
  const databaseUrl = Bun.env.GEZYCBT_DATABASE_URL ?? Bun.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("GEZYCBT_DATABASE_URL is required for admin bootstrap");
  }
  const password = (await Bun.stdin.text()).replace(/(?:\r?\n)+$/u, "");
  const database = createBunSqlDatabase(databaseUrl);
  try {
    const repository = new SqlUserRepository(database);
    const service = new AdminBootstrapService(repository, consoleAudit);
    const user = await service.run({ ...args, password });
    console.log(`Admin bootstrap completed for ${user.username} (${user.id})`);
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (error instanceof UserConflictError) {
      console.error(
        "Admin bootstrap rejected: an admin account already exists.",
      );
    } else {
      console.error(
        error instanceof Error ? error.message : "Admin bootstrap failed",
      );
    }
    process.exitCode = 1;
  });
}
