import React, { useState } from "react";
import type { Issue, DiffHunk } from "@alucify/shared-types";

const IMPACT_COLORS: Record<string, string> = {
  critical: "text-red-600 bg-red-50 border-red-200",
  high: "text-orange-600 bg-orange-50 border-orange-200",
  medium: "text-yellow-600 bg-yellow-50 border-yellow-200",
  low: "text-gray-500 bg-gray-50 border-gray-200",
};

function DiffHunkView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="flex flex-col gap-1.5 text-xs font-mono">
      <p className="text-gray-400 font-sans font-semibold uppercase tracking-wide text-[10px]">
        {hunk.sectionTitle}
      </p>
      {hunk.before && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2">
          <p className="text-red-600 font-semibold mb-1">- Replace:</p>
          <p className="text-red-700 whitespace-pre-wrap">{hunk.before}</p>
        </div>
      )}
      <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2">
        <p className="text-green-600 font-semibold mb-1">+ With:</p>
        <p className="text-gray-800 whitespace-pre-wrap">{hunk.after}</p>
      </div>
    </div>
  );
}

interface Props {
  issue: Issue;
  index: number;
  state: "pending" | "accepted" | "rejected";
  applied: boolean;
  onAccept: () => void;
  onReject: () => void;
}

export function SuggestionCard({ issue, index, state, applied, onAccept, onReject }: Props) {
  const [diffOpen, setDiffOpen] = useState(false);
  const hasDiffs = issue.diffs && issue.diffs.length > 0;
  const impactColor = IMPACT_COLORS[issue.impact] ?? IMPACT_COLORS.low;
  const isAccepted = state === "accepted";
  const isRejected = state === "rejected";

  return (
    <div className={`border rounded-lg px-4 py-3 flex flex-col gap-2 transition-opacity ${
      isRejected ? "border-gray-200 bg-gray-50 opacity-60" : "border-gray-200 bg-white"
    }`}>
      {/* Header: circle + title + badge */}
      <div className="flex items-start gap-2">
        {applied ? (
          <div className="mt-0.5 w-4 h-4 rounded-full bg-green-500 shrink-0 flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : (
          <button
            onClick={isAccepted ? onReject : onAccept}
            className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
              isAccepted ? "border-indigo-500 bg-indigo-500" : "border-gray-300 bg-white"
            }`}
            title={isAccepted ? "Click to reject" : "Click to accept"}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-xs font-semibold leading-snug ${isRejected ? "line-through text-gray-400" : "text-gray-800"}`}>
              Requirement {index}: {issue.summary}
            </p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 uppercase ${impactColor}`}>
              {issue.impact}
            </span>
          </div>
        </div>
      </div>

      {/* Suggestion */}
      {issue.suggestion && (
        <p className="text-xs text-gray-600 pl-6">
          <span className="font-semibold text-gray-500">Suggestion: </span>
          {issue.suggestion}
        </p>
      )}

      {/* Diff toggle */}
      {hasDiffs && (
        <div className="pl-6">
          <button
            onClick={() => setDiffOpen((o) => !o)}
            className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1"
          >
            <span>{diffOpen ? "▲ Hide diff" : "▶ Show diff"}</span>
          </button>
          {diffOpen && (
            <div className="mt-2 flex flex-col gap-3">
              {issue.diffs!.map((hunk, i) => (
                <DiffHunkView key={i} hunk={hunk} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Applied badge or Accept/Reject buttons */}
      {applied ? (
        <div className="flex items-center gap-1.5 pl-6 pt-1">
          <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-xs font-semibold text-green-600">Applied</span>
        </div>
      ) : (
        <div className="flex gap-2 pl-6 pt-1">
          <button
            onClick={onAccept}
            className={`text-xs px-3 py-1 rounded-md border transition-colors ${
              isAccepted
                ? "bg-indigo-500 text-white border-indigo-500"
                : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-500"
            }`}
          >
            Accept
          </button>
          <button
            onClick={onReject}
            className={`text-xs px-3 py-1 rounded-md border transition-colors ${
              isRejected
                ? "bg-gray-200 text-gray-700 border-gray-300"
                : "bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700"
            }`}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
