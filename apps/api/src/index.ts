import { loadAppConfig } from "@gezycbt/config";
import { createRuntimeDependencies } from "./bootstrap/runtime-dependencies";
import { startServer } from "./bootstrap/start-server";

const config = loadAppConfig(Bun.env);
const dependencies = createRuntimeDependencies(config);
const server = startServer(config, dependencies);

process.on("SIGINT", () => void server.stop());
process.on("SIGTERM", () => void server.stop());
