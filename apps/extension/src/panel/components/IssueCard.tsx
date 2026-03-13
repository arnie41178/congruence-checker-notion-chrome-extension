import React, { useState } from "react";
import type { Issue } from "@alucify/shared-types";

const IMPACT_COLORS: Record<Issue["impact"], string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-blue-100 text-blue-700 border-blue-200",
};

interface Props {
  issue: Issue;
  onExpand?: (issueId: string) => void;
}

export function IssueCard({ issue, onExpand }: Props) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && onExpand) onExpand(issue.id);
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors"
        onClick={toggle}
      >
        <span
          className={`mt-0.5 text-xs font-semibold px-2 py-0.5 rounded border shrink-0 ${IMPACT_COLORS[issue.impact]}`}
        >
          {issue.impact.toUpperCase()}
        </span>
        <span className="text-sm font-medium text-gray-800 flex-1">{issue.summary}</span>
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 bg-gray-50 flex flex-col gap-3 pt-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Description</p>
            <p className="text-sm text-gray-700">{issue.description}</p>
          </div>
          {issue.evidence && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Evidence</p>
              <p className="text-sm text-gray-700">{issue.evidence}</p>
            </div>
          )}
          {issue.risk && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Risk</p>
              <p className="text-sm text-gray-700">{issue.risk}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Resolution</p>
            <p className="text-sm text-gray-700">{issue.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
