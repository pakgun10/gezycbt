import type { AppConfig } from "@gezycbt/config";
import { createApp } from "./create-app";

export interface RunningServer {
  stop(): void;
}

export function startServer(config: AppConfig): RunningServer {
  const app = createApp(config).listen({
    hostname: config.host,
    port: config.port,
  });
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      app.stop();
    },
  };
}
