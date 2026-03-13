import type { FastifyInstance } from "fastify";
import { startAnalysis } from "../services/analysis.service.js";
import { getJob, checkAndIncrementLimit } from "../services/job-store.js";
import type { AnalysisRequest } from "@alucify/shared-types";

export async function analysisRoutes(app: FastifyInstance) {
  app.post("/analysis/run", async (request, reply) => {
    const clientId = (request.headers["x-client-id"] as string) ?? "unknown";
    const body = request.body as AnalysisRequest;

    if (!body?.prdText && !body?.repo?.files?.length) {
      return reply.code(400).send({ error: "bad_request", message: "prdText or repo files required." });
    }

    // Usage limit check
    const withinLimit = await checkAndIncrementLimit(clientId);
    if (!withinLimit) {
      return reply.code(429).send({
        error: "daily_limit_reached",
        message: "You've reached the daily analysis limit. Try again tomorrow.",
      });
    }

    const jobId = await startAnalysis({
      notionPageId: body.notionPageId ?? "unknown",
      prdText: body.prdText ?? "",
      repo: body.repo ?? { name: "unknown", files: [], meta: { totalFiles: 0, totalChars: 0 } },
    });

    return reply.code(202).send({ jobId, status: "pending" });
  });

  app.get<{ Params: { jobId: string } }>("/analysis/:jobId", async (request, reply) => {
    const { jobId } = request.params;
    const job = await getJob(jobId);
    if (!job) {
      return reply.code(404).send({ error: "not_found", message: "Job not found or expired." });
    }
    return reply.send(job);
  });
}
