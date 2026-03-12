import { v4 as uuidv4 } from "uuid";
import type { JobState, AnalysisResult, Issue } from "@alucify/shared-types";

// In-memory job store (Phase 0 — no Redis yet)
const jobs = new Map<string, JobState>();

const STAGE_LABELS = [
  "Extracting PRD intent...",
  "Scanning repository...",
  "Mapping dependencies...",
  "Detecting incongruences...",
];

const MOCK_ISSUES: Issue[] = [
  {
    id: "issue-1",
    summary: "Payment gateway API endpoint undefined in codebase",
    description:
      "The PRD references a POST /payments/initiate endpoint that does not exist in the current codebase. The payment flow described in Section 3.2 cannot be implemented without this endpoint.",
    impact: "critical",
    recommendation:
      "Define and implement the POST /payments/initiate handler before handing off to the AI coding agent. Specify request/response schema and error states.",
    affectedArea: "payments",
  },
  {
    id: "issue-2",
    summary: "User role 'editor' not defined in auth model",
    description:
      "The PRD mentions an 'editor' role with granular content permissions, but the current auth model only recognizes 'admin' and 'viewer'. Role-based access control logic will produce undefined behaviour.",
    impact: "high",
    recommendation:
      "Extend the roles enum and permission matrix to include 'editor'. Update the auth middleware to handle the new role before spec implementation.",
    affectedArea: "auth",
  },
  {
    id: "issue-3",
    summary: "Notification service referenced but not scaffolded",
    description:
      "Section 5 of the PRD describes email and push notifications on user events. There is no notification service, queue, or email provider integration present in the repository.",
    impact: "medium",
    recommendation:
      "Either scaffold a basic notification service stub with the expected interface, or scope notifications out of the current sprint before running the AI agent.",
    affectedArea: "notifications",
  },
];

export function createJob(notionPageId: string): string {
  const jobId = uuidv4();
  const job: JobState = {
    jobId,
    status: "pending",
    stage: 1,
    stageLabel: STAGE_LABELS[0],
  };
  jobs.set(jobId, job);
  simulateProgress(jobId, notionPageId);
  return jobId;
}

export function getJob(jobId: string): JobState | null {
  return jobs.get(jobId) ?? null;
}

function simulateProgress(jobId: string, notionPageId: string) {
  let stage = 1;

  const advance = () => {
    const job = jobs.get(jobId);
    if (!job) return;

    stage++;
    if (stage <= 4) {
      jobs.set(jobId, {
        ...job,
        status: "running",
        stage,
        stageLabel: STAGE_LABELS[stage - 1],
      });
      setTimeout(advance, 2000);
    } else {
      const result: AnalysisResult = {
        jobId,
        notionPageId,
        issueCount: MOCK_ISSUES.length,
        badge: "needs-work",
        issues: MOCK_ISSUES,
        analyzedAt: new Date().toISOString(),
      };
      jobs.set(jobId, {
        ...job,
        status: "completed",
        result,
      });
    }
  };

  // Start first transition after 2s
  jobs.set(jobId, { ...jobs.get(jobId)!, status: "running" });
  setTimeout(advance, 2000);
}
