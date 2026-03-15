import type { AnalysisResult } from "@alucify/shared-types";

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
