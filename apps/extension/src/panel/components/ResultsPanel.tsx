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
  notionPageId: string | null;
  onReset: () => void;
  onIssueExpand: (issueId: string) => void;
  onResultsViewed: () => void;
}

export function ResultsPanel({ result, notionPageId, onReset, onIssueExpand: _onIssueExpand, onResultsViewed }: Props) {
  const hasScorecard = !!result.scorecard;
  // Always default to Scorecard tab; fall back to suggestions if no scorecard
  const [tab, setTab] = useState<Tab>("scorecard");

  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(() => new Set<string>());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(() => new Set<string>());

  const [copied, setCopied] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [applyState, setApplyState] = useState<"idle" | "applying" | "done">("idle");
  const [applyResult, setApplyResult] = useState<{ applied: number; errors: string[]; appliedIssueIds?: string[] } | null>(null);
  const [showAcceptHint, setShowAcceptHint] = useState(false);
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

  const issuesWithAccepted = result.issues.map((i) => ({ ...i, accepted: acceptedIds.has(i.id) && !rejectedIds.has(i.id) }));

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

  const appliedIds = new Set(applyResult?.appliedIssueIds ?? []);

  const pendingApplyCount = result.issues.filter(
    (i) => acceptedIds.has(i.id) && !rejectedIds.has(i.id) && !appliedIds.has(i.id) && i.diffs?.length
  ).length;

  const handleApplyToDoc = async () => {
    if (pendingApplyCount === 0) {
      setShowAcceptHint(true);
      return;
    }
    setShowAcceptHint(false);
    const diffs = result.issues
      .filter((i) => acceptedIds.has(i.id) && !rejectedIds.has(i.id) && !appliedIds.has(i.id) && i.diffs?.length)
      .flatMap((i) => (i.diffs ?? []).map((d) => ({
        issueId: i.id,
        sectionTitle: d.sectionTitle,
        before: d.before,
        after: d.after,
      })));
    setApplyState("applying");
    try {
      const res = await chrome.runtime.sendMessage({ type: "APPLY_CHANGES", notionPageId, diffs }) as { applied?: number; errors?: string[]; appliedIssueIds?: string[]; error?: string };
      if (res?.error) {
        setApplyResult({ applied: 0, errors: [res.error], appliedIssueIds: [] });
      } else {
        // Merge new appliedIssueIds with previously applied ones
        const prev = applyResult?.appliedIssueIds ?? [];
        const next = res?.appliedIssueIds ?? [];
        setApplyResult({ applied: res?.applied ?? 0, errors: res?.errors ?? [], appliedIssueIds: [...prev, ...next] });
      }
    } catch (e) {
      setApplyResult({ applied: 0, errors: [String(e)], appliedIssueIds: applyResult?.appliedIssueIds ?? [] });
    }
    setApplyState("done");
    setTimeout(() => setApplyState("idle"), 3000);
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
          {/* Primary CTA: Apply Suggestions to Document + secondary dropdown */}
          <div className="flex flex-col gap-1">
            <div className="flex gap-1 relative" ref={dropdownRef}>
              <button
                onClick={handleApplyToDoc}
                disabled={applyState === "applying"}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50"
              >
                {applyState === "applying"
                  ? "Applying..."
                  : applyState === "done"
                  ? "Done ✓"
                  : `Apply Suggestions to Document${pendingApplyCount > 0 ? ` (${pendingApplyCount})` : ""}`}
              </button>
              <button
                onClick={() => setShowDownloadMenu((v) => !v)}
                className="px-2.5 border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600 hover:border-gray-300 rounded-lg transition-colors"
                aria-label="More options"
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
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[200px] overflow-hidden">
                  <button
                    onClick={handleCopyPrompt}
                    className="w-full text-left text-xs px-4 py-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    {copied ? "Copied!" : "Copy Resolution Prompt"}
                  </button>
                  <div className="border-t border-gray-100" />
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

            {/* Status messages */}
            {showAcceptHint && (
              <p className="text-xs text-center text-gray-400">Accept suggestions to apply</p>
            )}
            {applyResult && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-center text-gray-500">
                  {applyResult.applied} applied{applyResult.errors.length > 0 ? ` · ${applyResult.errors.length} failed` : ""}
                </p>
                {applyResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-500 break-words">{e}</p>
                ))}
              </div>
            )}
          </div>

          {/* Accept All */}
          {sortedIssues.some((i) => !appliedIds.has(i.id) && (!acceptedIds.has(i.id) || rejectedIds.has(i.id))) && (
            <button
              onClick={() => {
                const ids = sortedIssues.filter((i) => !appliedIds.has(i.id)).map((i) => i.id);
                setAcceptedIds((prev) => new Set([...prev, ...ids]));
                setRejectedIds((prev) => { const s = new Set(prev); ids.forEach((id) => s.delete(id)); return s; });
              }}
              className="text-xs text-indigo-500 hover:text-indigo-700 self-end"
            >
              Accept all
            </button>
          )}

          <div className="flex flex-col gap-2">
            {sortedIssues.map((issue, idx) => (
              <SuggestionCard
                key={issue.id}
                issue={issue}
                index={idx + 1}
                state={rejectedIds.has(issue.id) ? "rejected" : acceptedIds.has(issue.id) ? "accepted" : "pending"}
                applied={appliedIds.has(issue.id)}
                onAccept={() => {
                  setAcceptedIds((prev) => new Set([...prev, issue.id]));
                  setRejectedIds((prev) => { const s = new Set(prev); s.delete(issue.id); return s; });
                }}
                onReject={() => {
                  setRejectedIds((prev) => new Set([...prev, issue.id]));
                  setAcceptedIds((prev) => { const s = new Set(prev); s.delete(issue.id); return s; });
                }}
              />
            ))}
          </div>
        </>
      )}

    </div>
  );
}
