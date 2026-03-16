import React, { useEffect, useRef, useState } from "react";
import type { AnalysisResult, IssueImpact } from "@alucify/shared-types";
import { SuggestionCard } from "./SuggestionCard";
import { ScorecardPanel } from "./ScorecardPanel";
import { downloadJson, downloadMarkdown } from "../../lib/download";
import { formatMarkdownReport, formatResolutionPrompt } from "../../lib/report-formatter";

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
  // Always default to Scorecard tab; fall back to suggestions if no scorecard
  const [tab, setTab] = useState<Tab>("scorecard");

  // All issues accepted by default
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(
    () => new Set(result.issues.map((i) => i.id))
  );

  const [copied, setCopied] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onResultsViewed();
    // If no scorecard, start on suggestions
    if (!hasScorecard) setTab("suggestions");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showDownloadMenu) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDownloadMenu]);

  const badge = BADGE_CONFIG[result.badge];
  const fileSlug = `congruence-report-${result.jobId}`;

  const issuesWithAccepted = result.issues.map((i) => ({ ...i, accepted: acceptedIds.has(i.id) }));

  const handleCopyPrompt = async () => {
    const prompt = formatResolutionPrompt(result, acceptedIds);
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadMarkdown = () => {
    setShowDownloadMenu(false);
    downloadMarkdown(`${fileSlug}.md`, formatMarkdownReport({ ...result, issues: issuesWithAccepted }));
  };

  const handleDownloadJson = () => {
    setShowDownloadMenu(false);
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

      <button
        onClick={onReset}
        className="text-xs text-gray-400 hover:text-gray-600 underline self-center -mt-2"
      >
        Run another check
      </button>

      {/* Tab switcher — prominent active state */}
      <div className="flex gap-1 bg-gray-200 rounded-xl p-1">
        {hasScorecard && (
          <button
            onClick={() => setTab("scorecard")}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${
              tab === "scorecard"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            Scorecard
          </button>
        )}
        <button
          onClick={() => setTab("suggestions")}
          className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${
            tab === "suggestions"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-500 hover:text-gray-800"
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
        <>
          {/* Copy Resolution Prompt — subtle, sits just below the tab */}
          <div className="flex gap-1 relative" ref={dropdownRef}>
            <button
              onClick={handleCopyPrompt}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50 hover:text-gray-700 hover:border-gray-300 transition-colors"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {copied ? "Copied!" : "Copy Resolution Prompt"}
            </button>
            <button
              onClick={() => setShowDownloadMenu((v) => !v)}
              className="px-2.5 border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600 hover:border-gray-300 rounded-lg transition-colors"
              aria-label="More export options"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showDownloadMenu ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showDownloadMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[180px] overflow-hidden">
                <button
                  onClick={handleDownloadMarkdown}
                  className="w-full text-left text-xs px-4 py-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Download Report (.md)
                </button>
                <div className="border-t border-gray-100" />
                <button
                  onClick={handleDownloadJson}
                  className="w-full text-left text-xs px-4 py-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Download JSON
                </button>
              </div>
            )}
          </div>

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
        </>
      )}

    </div>
  );
}
