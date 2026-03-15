import React, { useEffect, useState } from "react";
import type { AnalysisResult, IssueImpact } from "@alucify/shared-types";
import { SuggestionCard } from "./SuggestionCard";
import { ScorecardPanel } from "./ScorecardPanel";
import { downloadJson, downloadMarkdown } from "../../lib/download";
import { formatMarkdownReport } from "../../lib/report-formatter";

const IMPACT_ORDER: Record<IssueImpact, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const BADGE_CONFIG = {
  "not-ready": { label: "Not Ready", color: "bg-red-100 text-red-700 border-red-300" },
  "needs-work": { label: "Needs Work", color: "bg-orange-100 text-orange-700 border-orange-300" },
  "mostly-ready": { label: "Mostly Ready", color: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  ready: { label: "Ready", color: "bg-green-100 text-green-700 border-green-300" },
};

type Tab = "scorecard" | "suggestions";

interface Props {
  result: AnalysisResult;
  onReset: () => void;
  onIssueExpand: (issueId: string) => void;
  onResultsViewed: () => void;
}

export function ResultsPanel({ result, onReset, onIssueExpand: _onIssueExpand, onResultsViewed }: Props) {
  const hasScorecard = !!result.scorecard;
  const [tab, setTab] = useState<Tab>(hasScorecard ? "scorecard" : "suggestions");

  // All issues accepted by default
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(
    () => new Set(result.issues.map((i) => i.id))
  );

  useEffect(() => {
    onResultsViewed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badge = BADGE_CONFIG[result.badge];
  const fileSlug = `congruence-report-${result.jobId}`;

  // Attach accepted state to issues before passing to downloads
  const issuesWithAccepted = result.issues.map((i) => ({ ...i, accepted: acceptedIds.has(i.id) }));

  const handleDownloadMarkdown = () => {
    downloadMarkdown(`${fileSlug}.md`, formatMarkdownReport({ ...result, issues: issuesWithAccepted }));
  };

  const handleDownloadJson = () => {
    downloadJson(`${fileSlug}.json`, { ...result, issues: issuesWithAccepted });
  };

  const sortedIssues = [...result.issues].sort(
    (a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Summary card */}
      <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">
            {result.issueCount} issue{result.issueCount !== 1 ? "s" : ""} detected
          </p>
          <p className="text-xs text-gray-400">Analysis complete</p>
        </div>
        <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${badge.color}`}>
          {badge.label}
        </span>
      </div>

      {/* Download buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleDownloadMarkdown}
          className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50 hover:border-gray-300"
        >
          Download Report (.md)
        </button>
        <button
          onClick={handleDownloadJson}
          className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50 hover:border-gray-300"
        >
          Download JSON
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {hasScorecard && (
          <button
            onClick={() => setTab("scorecard")}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
              tab === "scorecard"
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Scorecard
          </button>
        )}
        <button
          onClick={() => setTab("suggestions")}
          className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
            tab === "suggestions"
              ? "bg-white text-gray-800 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Suggestions
        </button>
      </div>

      {/* Tab content */}
      {tab === "scorecard" && result.scorecard && (
        <ScorecardPanel scorecard={result.scorecard} />
      )}

      {tab === "suggestions" && (
        <div className="flex flex-col gap-2">
          {sortedIssues.map((issue, idx) => (
            <SuggestionCard
              key={issue.id}
              issue={issue}
              index={idx + 1}
              accepted={acceptedIds.has(issue.id)}
              onAccept={() => setAcceptedIds((prev) => new Set([...prev, issue.id]))}
              onReject={() => setAcceptedIds((prev) => { const s = new Set(prev); s.delete(issue.id); return s; })}
            />
          ))}
        </div>
      )}

      <button
        onClick={onReset}
        className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline self-center"
      >
        Run another check
      </button>
    </div>
  );
}
