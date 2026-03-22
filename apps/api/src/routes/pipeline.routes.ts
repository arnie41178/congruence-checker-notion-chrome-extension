import type { FastifyInstance } from "fastify";
import { startPipelineAnalysis } from "../services/pipeline-runner.service.js";
import type { RepoContext } from "@alucify/shared-types";

export async function pipelineRoutes(app: FastifyInstance) {
  app.post("/analysis/pipeline", async (request, reply) => {
    const body = request.body as { prdContent?: string; repo?: RepoContext };

    if (!body?.prdContent?.trim()) {
      return reply.code(400).send({ error: "bad_request", message: "prdContent is required." });
    }

    const repoFiles = body.repo?.files ?? [];
    const jobId = await startPipelineAnalysis(body.prdContent, repoFiles);
    return reply.code(202).send({ jobId, status: "pending" });
  });
}
