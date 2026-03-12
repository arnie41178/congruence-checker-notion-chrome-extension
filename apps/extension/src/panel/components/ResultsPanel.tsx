import React, { useEffect } from "react";
import type { AnalysisResult } from "@alucify/shared-types";
import { IssueCard } from "./IssueCard";

const BADGE_CONFIG = {
  "not-ready": { label: "Not Ready", color: "bg-red-100 text-red-700 border-red-300" },
  "needs-work": { label: "Needs Work", color: "bg-orange-100 text-orange-700 border-orange-300" },
  "mostly-ready": { label: "Mostly Ready", color: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  ready: { label: "Ready", color: "bg-green-100 text-green-700 border-green-300" },
};

interface Props {
  result: AnalysisResult;
  onReset: () => void;
  onIssueExpand: (issueId: string) => void;
  onResultsViewed: () => void;
}

export function ResultsPanel({ result, onReset, onIssueExpand, onResultsViewed }: Props) {
  useEffect(() => {
    onResultsViewed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badge = BADGE_CONFIG[result.badge];

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

      {/* Issue list */}
      <div className="flex flex-col gap-2">
        {result.issues.map((issue) => (
          <IssueCard key={issue.id} issue={issue} onExpand={onIssueExpand} />
        ))}
      </div>

      <button
        onClick={onReset}
        className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline self-center"
      >
        Run another check
      </button>
    </div>
  );
}
