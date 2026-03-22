import type { FastifyInstance } from "fastify";

export async function configRoutes(app: FastifyInstance) {
  app.get("/config", async () => ({
    analysisMethod: (process.env.ANALYSIS_METHOD ?? "pipeline") as "pipeline" | "fast",
    consensusRuns: parseInt(process.env.PIPELINE_CONSENSUS_RUNS ?? "5", 10),
  }));
}
