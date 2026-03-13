import type { PrdEntities } from "./prd-extraction.prompt.js";
import type { RepoIndex } from "../services/repo-indexer.js";

export const CONGRUENCE_SYSTEM = `You are an expert software architect performing a congruence analysis between a Product Requirements Document (PRD) and a codebase.

Your job is to find CONFLICTS and GAPS — places where the PRD assumes something that does not exist or conflicts with what is actually in the code.

Focus on:
1. APIs or endpoints referenced in the PRD but missing from the codebase
2. Data models or entities in the PRD not found in the codebase
3. Features or user flows in the PRD with no corresponding code
4. Technical requirements the current codebase cannot satisfy
5. External integrations mentioned in PRD but not wired up in code

Severity levels:
- critical: Implementation is IMPOSSIBLE without this — foundational dependency missing
- high: Requires significant unplanned work or rearchitecture
- medium: Will cause confusion, bugs, or scope creep
- low: Minor ambiguity worth clarifying

Return a JSON object:
{
  "issues": [
    {
      "id": "issue-1",
      "summary": "One-line description of the conflict",
      "description": "2-3 sentences explaining what the PRD expects vs. what the codebase has",
      "impact": "critical|high|medium|low",
      "recommendation": "Concrete action to resolve this before the AI agent runs",
      "affectedArea": "auth|payments|api|data-model|integration|feature|other"
    }
  ],
  "badge": "not-ready|needs-work|mostly-ready|ready"
}

Badge rules:
- not-ready: 1+ critical issues
- needs-work: No critical, but 1+ high issues
- mostly-ready: Only medium/low issues
- ready: No issues found

Return ONLY valid JSON. No markdown, no explanation.`;

export function buildCongruencePrompt(
  prdText: string,
  prdEntities: PrdEntities,
  repoIndex: RepoIndex,
  heuristicFindings: string[]
): string {
  const repoSummary = buildRepoSummary(repoIndex);

  return `## PRD Content
${prdText.slice(0, 12_000)}

## Extracted PRD Requirements
Entities: ${prdEntities.entities.join(", ") || "none"}
API Endpoints: ${prdEntities.apiEndpoints.join(", ") || "none"}
User Flows: ${prdEntities.userFlows.join(", ") || "none"}
Tech Requirements: ${prdEntities.techRequirements.join(", ") || "none"}
Integrations: ${prdEntities.integrations.join(", ") || "none"}

## Repository Overview
${repoSummary}

## Heuristic Pre-filter Findings
${heuristicFindings.length > 0 ? heuristicFindings.join("\n") : "No heuristic issues detected."}

Perform the congruence analysis and return the JSON result.`;
}

function buildRepoSummary(index: RepoIndex): string {
  const lines: string[] = [];
  lines.push(`File count: ${index.fileCount}`);
  lines.push(`\nFile tree (top-level):\n${index.fileTree.slice(0, 3000)}`);
  if (index.routes.length > 0) lines.push(`\nAPI Routes found:\n${index.routes.join("\n")}`);
  if (index.models.length > 0) lines.push(`\nModels/Schemas found:\n${index.models.join("\n")}`);
  if (index.services.length > 0) lines.push(`\nServices found:\n${index.services.join("\n")}`);
  if (index.keyFileContents) lines.push(`\nKey file contents:\n${index.keyFileContents.slice(0, 6000)}`);
  return lines.join("\n");
}
