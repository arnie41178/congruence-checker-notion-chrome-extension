import type { AnalysisResult } from "@alucify/shared-types";

export function formatResolutionPrompt(
  result: AnalysisResult,
  acceptedIds: Set<string>
): string {
  const accepted = result.issues.filter((i) => acceptedIds.has(i.id));
  const lines: string[] = [];

  lines.push("## Role");
  lines.push("You are an AI writing assistant helping a product manager improve a Product Requirements Document (PRD). Your task is to apply a set of reviewed and accepted changes to the document.");
  lines.push("");
  lines.push("## Goal");
  lines.push("Apply the accepted changes listed below to the PRD document. Each change has been reviewed and approved. Modify only the sections indicated — do not alter any other part of the document.");
  lines.push("");
  lines.push("## Steps");
  lines.push("1. Read each accepted change carefully, noting the section it applies to.");
  lines.push('2. For changes with a "Before" text: locate that exact text in the document and replace it with the "After" text.');
  lines.push('3. For additions (no "Before" text): insert the "After" text in the indicated section.');
  lines.push("4. Preserve the document's existing structure, heading hierarchy, and formatting style throughout.");
  lines.push("5. After applying all changes, confirm which sections were updated.");
  lines.push("");
  lines.push("## Accepted Changes");
  lines.push("");

  if (accepted.length === 0) {
    lines.push("_(No changes accepted — accept at least one suggestion before copying.)_");
    return lines.join("\n");
  }

  accepted.forEach((issue, i) => {
    lines.push(`### Change ${i + 1} — ${issue.summary} [${issue.impact.toUpperCase()}]`);
    lines.push(`**Description:** ${issue.description}`);
    if (issue.diffs && issue.diffs.length > 0) {
      issue.diffs.forEach((hunk) => {
        lines.push(`**Section:** ${hunk.sectionTitle}`);
        lines.push(`**Before:** ${hunk.before || "(new addition)"}`);
        lines.push(`**After:** ${hunk.after}`);
      });
    } else if (issue.suggestion) {
      lines.push(`**Suggestion:** ${issue.suggestion}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

const BADGE_LABEL: Record<string, string> = {
  "not-ready": "Not Ready",
  "needs-work": "Needs Work",
  "mostly-ready": "Mostly Ready",
  "ready": "Ready",
};

export function formatMarkdownReport(result: AnalysisResult): string {
  const lines: string[] = [];

  lines.push("# Congruence Report");
  lines.push("");
  lines.push(`**Readiness:** ${BADGE_LABEL[result.badge] ?? result.badge}`);
  lines.push(`**Issues found:** ${result.issueCount}`);
  lines.push(`**Analyzed at:** ${result.analyzedAt}`);
  lines.push(`**Job ID:** ${result.jobId}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (result.issues.length === 0) {
    lines.push("No issues detected.");
    return lines.join("\n");
  }

  result.issues.forEach((issue, i) => {
    const status = issue.accepted === false ? "❌ Rejected" : "✅ Accepted";
    lines.push(`## Issue ${i + 1} — ${issue.summary} [${issue.impact.toUpperCase()}] ${status}`);
    lines.push("");
    if (issue.affectedArea) {
      lines.push(`**Affected Area:** ${issue.affectedArea}`);
      lines.push("");
    }
    lines.push(`**Description:** ${issue.description}`);
    lines.push("");
    if (issue.evidence) {
      lines.push(`**Evidence:** ${issue.evidence}`);
      lines.push("");
    }
    if (issue.suggestion) {
      lines.push(`**Suggestion:** ${issue.suggestion}`);
      lines.push("");
    }
    if (issue.diffs && issue.diffs.length > 0) {
      lines.push("**Diffs:**");
      lines.push("");
      issue.diffs.forEach((hunk) => {
        lines.push(`*${hunk.sectionTitle}*`);
        lines.push("");
        if (hunk.before) {
          lines.push("```diff");
          lines.push(`- ${hunk.before}`);
          lines.push(`+ ${hunk.after}`);
          lines.push("```");
        } else {
          lines.push("```diff");
          lines.push(`+ ${hunk.after}`);
          lines.push("```");
        }
        lines.push("");
      });
    }
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}
