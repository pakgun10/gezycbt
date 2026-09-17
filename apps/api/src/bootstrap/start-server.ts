import type { AppConfig } from "@gezycbt/config";
import { type AppDependencies, createApp } from "./create-app";

export interface RunningServer {
  stop(): Promise<void>;
}

export function startServer(
  config: AppConfig,
  dependencies: AppDependencies & {
    readonly shutdown?: () => Promise<void>;
  } = {},
): RunningServer {
  const app = createApp(config, undefined, dependencies).listen({
    hostname: config.host,
    port: config.port,
  });
  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      app.stop();
      await dependencies.shutdown?.();
    },
  };
}
