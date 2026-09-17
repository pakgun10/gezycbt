import type { AppConfig } from "@gezycbt/config";
import type { Id } from "@gezycbt/contracts";
import { createBunSqlDatabase, type DatabasePort } from "@gezycbt/database";
import type { Elysia } from "elysia";
import {
  AuthLoginService,
  AuthSessionService,
  PasswordService,
  registerAuthRoutes,
  SqlAuthSessionRepository,
  SqlAuthThrottleRepository,
  SqlLoginFailureLimiter,
} from "../modules/auth";
import { SqlUserRepository } from "../modules/users";
import type { AppDependencies } from "./create-app";

export interface RuntimeDependencies extends AppDependencies {
  readonly database?: DatabasePort;
  readonly shutdown: () => Promise<void>;
}

/**
 * Builds process-owned dependencies for a real API process.
 *
 * Migrations deliberately remain a separate release command. API startup only
 * opens the pool, checks readiness, and mounts the route adapters that are
 * currently production-safe (authentication at this stage).
 */
export function createRuntimeDependencies(
  config: AppConfig,
): RuntimeDependencies {
  if (!config.databaseUrl) {
    return { shutdown: async () => undefined };
  }

  const database = createBunSqlDatabase(config.databaseUrl);
  const users = new SqlUserRepository(database);
  const sessions = new AuthSessionService({
    repository: new SqlAuthSessionRepository(database),
  });
  const login = new AuthLoginService({
    users,
    passwords: new PasswordService(),
    sessions,
    limiter: new SqlLoginFailureLimiter(
      new SqlAuthThrottleRepository(database),
    ),
  });
  const authOptions = {
    loginService: login,
    sessionService: sessions,
    expectedOrigin: config.appOrigin,
    currentUser: async (userId: Id) => {
      const user = await users.findById(userId);
      if (!user) return null;
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        forcePasswordChange: user.forcePasswordChange,
      };
    },
  };

  let closed = false;
  return {
    database,
    readinessChecks: [
      {
        name: "database",
        check: async () => {
          await database.query("SELECT 1 AS ready");
        },
      },
    ],
    registerRoutes: (app: Elysia) => registerAuthRoutes(app, authOptions),
    shutdown: async () => {
      if (closed) return;
      closed = true;
      await database.close();
    },
  };
}
