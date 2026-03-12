import type { FastifyInstance } from "fastify";
import { createJob, getJob } from "../services/analysis.service.js";

export async function analysisRoutes(app: FastifyInstance) {
  app.post("/analysis/run", async (request, reply) => {
    const body = request.body as { notionPageId?: string };
    const notionPageId = body?.notionPageId ?? "unknown";
    const jobId = createJob(notionPageId);
    return reply.code(202).send({ jobId, status: "pending" });
  });

  app.get<{ Params: { jobId: string } }>("/analysis/:jobId", async (request, reply) => {
    const { jobId } = request.params;
    const job = getJob(jobId);
    if (!job) {
      return reply.code(404).send({ error: "not_found", message: "Job not found or expired." });
    }
    return reply.send(job);
  });
}
