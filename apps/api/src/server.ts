import Fastify from "fastify";
import cors from "@fastify/cors";
import { analysisRoutes } from "./routes/analysis.routes.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: ["chrome-extension://*", "http://localhost:*"],
  methods: ["GET", "POST", "OPTIONS"],
});

await app.register(analysisRoutes);

app.get("/health", async () => ({ status: "ok" }));

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`Alucify API listening on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
