import Fastify from "fastify";
import cors from "@fastify/cors";
import { analysisRoutes } from "./routes/analysis.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { configRoutes } from "./routes/config.routes.js";
import { pipelineRoutes } from "./routes/pipeline.routes.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});

await app.register(cors, {
  origin: ["chrome-extension://*", "http://localhost:*"],
  methods: ["GET", "POST", "OPTIONS"],
});

await app.register(analysisRoutes);
await app.register(authRoutes);
await app.register(configRoutes);
await app.register(pipelineRoutes);

app.get("/health", async () => ({ status: "ok" }));

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`Alucify API listening on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
