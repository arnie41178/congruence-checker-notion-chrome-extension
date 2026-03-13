import { v4 as uuidv4 } from "uuid";
import { anthropic, MODEL } from "../lib/anthropic.js";
import { createJob, updateJob } from "./job-store.js";
import { buildRepoIndex } from "./repo-indexer.js";
import {
  PRD_EXTRACTION_SYSTEM,
  buildPrdExtractionPrompt,
  type PrdEntities,
} from "../prompts/prd-extraction.prompt.js";
import { runPrdAudit, auditReportToIssues } from "./prd-auditor.service.js";
import type { AnalysisRequest, AnalysisResult, Issue } from "@alucify/shared-types";

const STAGE_LABELS = [
  "Extracting PRD intent...",
  "Scanning repository...",
  "Auditing PRD against codebase...",
  "Compiling results...",
];

export async function startAnalysis(request: AnalysisRequest): Promise<string> {
  const jobId = uuidv4();
  await createJob(jobId, {
    jobId,
    status: "pending",
    stage: 1,
    stageLabel: STAGE_LABELS[0],
  });

  // Run pipeline async — don't await
  runPipeline(jobId, request).catch(async (err) => {
    console.error(`[Analysis ${jobId}] Pipeline error:`, err);
    await updateJob(jobId, {
      status: "failed",
      error: "analysis_error",
      message: "Analysis could not be completed. Please try again.",
    });
  });

  return jobId;
}

async function runPipeline(jobId: string, request: AnalysisRequest) {
  const { prdText, repo, notionPageId } = request;

  console.log(`[Analysis ${jobId}] prdText length=${prdText.length} preview="${prdText.slice(0, 120).replace(/\n/g, " ")}"`);

  // ── Stage 1: Extract PRD entities ─────────────────────────────────────────
  await updateJob(jobId, { status: "running", stage: 1, stageLabel: STAGE_LABELS[0] });

  let prdEntities: PrdEntities = {
    entities: [], apiEndpoints: [], userFlows: [], techRequirements: [], integrations: [],
  };

  if (prdText.trim().length > 50) {
    try {
      const extraction = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: PRD_EXTRACTION_SYSTEM,
        messages: [{ role: "user", content: buildPrdExtractionPrompt(prdText) }],
      });
      const raw = extraction.content[0].type === "text" ? extraction.content[0].text : "{}";
      const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      prdEntities = JSON.parse(cleaned) as PrdEntities;
    } catch (err) {
      console.warn(`[Analysis ${jobId}] PRD extraction failed, continuing:`, err);
    }
  }

  // ── Stage 2: Build repo index (heuristic, no LLM) ─────────────────────────
  await updateJob(jobId, { stage: 2, stageLabel: STAGE_LABELS[1] });

  const repoIndex = buildRepoIndex(repo);

  // ── Stage 3: PRD Auditor agent (prd-auditor.md) ───────────────────────────
  await updateJob(jobId, { stage: 3, stageLabel: STAGE_LABELS[2] });

  const auditReport = await runPrdAudit(prdText, prdEntities, repoIndex);

  // ── Stage 4: Map audit report → structured issues ─────────────────────────
  await updateJob(jobId, { stage: 4, stageLabel: STAGE_LABELS[3] });

  const issues = auditReportToIssues(auditReport);
  const badge = deriveBadge(issues);

  const result: AnalysisResult = {
    jobId,
    notionPageId,
    issueCount: issues.length,
    badge,
    issues,
    analyzedAt: new Date().toISOString(),
  };

  await updateJob(jobId, { status: "completed", result });
}

function deriveBadge(issues: Issue[]): AnalysisResult["badge"] {
  if (issues.some((i) => i.impact === "critical")) return "not-ready";
  if (issues.some((i) => i.impact === "high")) return "needs-work";
  if (issues.length > 0) return "mostly-ready";
  return "ready";
}
