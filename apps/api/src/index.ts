import { loadAppConfig } from "@gezycbt/config";
import { startServer } from "./bootstrap/start-server";

const config = loadAppConfig(Bun.env);
const server = startServer(config);

process.on("SIGINT", () => server.stop());
process.on("SIGTERM", () => server.stop());
