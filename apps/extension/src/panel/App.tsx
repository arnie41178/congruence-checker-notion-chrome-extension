import React, { useEffect, useState } from "react";
import { useAnalysis } from "./hooks/useAnalysis";
import { useNotionPage } from "./hooks/useNotionPage";
import { useRepoMemory } from "./hooks/useRepoMemory";
import { useSettings } from "./hooks/useSettings";
import { RunCheckButton } from "./components/RunCheckButton";
import { RepoSelector } from "./components/RepoSelector";
import { ProgressStates } from "./components/ProgressStates";
import { ResultsPanel } from "./components/ResultsPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { OnboardingScreen } from "./components/OnboardingScreen";
import type { AnalysisMode } from "./hooks/useSettings";

type AppStep = "onboarding" | "idle" | "repo_selection" | "selection_review" | "running" | "results" | "error";

export default function App() {
  const { pageId, source, refresh: refreshPage } = useNotionPage();
  const { state: analysis, startAnalysis, reset: resetAnalysis, loadResult } = useAnalysis();
  const { state: repo, pickAndRead, useStoredRepo, clearSelection } = useRepoMemory(pageId);
  const { state: settings, save: saveSettings, saveNotionConnection, clearNotionConnection } = useSettings();
  const [step, setStep] = useState<AppStep>("idle");
  const [showSettings, setShowSettings] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string>("");
  // Notify background when panel opens
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "PANEL_OPENED" });
    return () => { chrome.runtime.sendMessage({ type: "PANEL_CLOSED" }); };
  }, []);

  // Detect pending selection (from context menu "Technical Review")
  useEffect(() => {
    chrome.storage.local.get("pendingSelection", (result) => {
      if (result.pendingSelection) {
        setPendingSelection(result.pendingSelection as string);
        setStep("selection_review");
      }
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.pendingSelection?.newValue) {
        setPendingSelection(changes.pendingSelection.newValue as string);
        setStep("selection_review");
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  // Once settings load, show onboarding if mode was never set
  useEffect(() => {
    if (settings.loaded && settings.mode === undefined) {
      setStep("onboarding");
    }
  }, [settings.loaded, settings.mode]);

  // Sync analysis phase into step
  useEffect(() => {
    if (analysis.phase === "running") setStep("running");
    if (analysis.phase === "results") setStep("results");
    if (analysis.phase === "error") setStep("error");
  }, [analysis.phase]);

  // When repo is selected and we were in repo_selection or selection_review, kick off analysis
  useEffect(() => {
    if (!repo.selected || !repo.lastResult) return;
    if (step !== "repo_selection" && step !== "selection_review") return;
    console.log("[Alucify] repo files being sent:", repo.lastResult.files.map(f => f.path));
    const repoPayload = {
      name: repo.selected.name,
      files: repo.lastResult.files,
      meta: {
        totalFiles: repo.lastResult.totalFiles,
        totalChars: repo.lastResult.totalChars,
      },
    };
    chrome.runtime.sendMessage({
      type: "TRACK",
      event: "repo_selected",
      properties: {
        repoName: repo.selected.name,
        fileCount: repo.selected.fileCount,
        totalChars: repo.selected.totalChars,
        wasCapped: repo.lastResult.wasCapped,
        notionPageId: pageId,
      },
    });
    if (step === "selection_review") {
      chrome.storage.local.remove("pendingSelection");
      startAnalysis(pageId ?? "unknown", repoPayload, pendingSelection);
    } else {
      startAnalysis(pageId ?? "unknown", repoPayload);
    }
  }, [repo.selected, repo.lastResult, step, pendingSelection]);

  const handleOnboardingComplete = (mode: AnalysisMode, apiKey: string) => {
    saveSettings(mode, apiKey);
    setStep("idle");
  };

  const handleRun = () => {
    setStep("repo_selection");
  };

  const handleReset = () => {
    resetAnalysis();
    clearSelection();
    setStep("idle");
  };

  const handleCancelSelection = () => {
    chrome.storage.local.remove("pendingSelection");
    setPendingSelection("");
    setStep("idle");
  };

  const handleResultsViewed = () => {
    chrome.runtime.sendMessage({
      type: "TRACK",
      event: "analysis_results_viewed",
      properties: { jobId: analysis.jobId },
    });
  };

  const handleIssueExpand = (issueId: string) => {
    chrome.runtime.sendMessage({
      type: "TRACK",
      event: "issue_expanded",
      properties: { issueId, jobId: analysis.jobId },
    });
  };

  const handleLoadJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!parsed.issues || !parsed.badge) throw new Error("Not a valid analysis-result.json");
        loadResult(parsed);
      } catch (err) {
        alert(`Could not load results: ${String(err)}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleConnectNotion = async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: "NOTION_AUTH" }) as { ok: boolean; workspace: string } | { error: string };
      if ("error" in result) throw new Error(result.error);
      const stored = await chrome.storage.local.get(["alucify_notion_token", "alucify_notion_workspace"]);
      saveNotionConnection(stored.alucify_notion_token as string, stored.alucify_notion_workspace as string);
    } catch (err) {
      console.error("[Alucify] Notion auth failed:", err);
      alert(`Notion connection failed: ${String(err)}`);
    }
  };

  const handleDisconnectNotion = () => {
    clearNotionConnection();
  };

  return (
    <div className="min-h-screen bg-white flex flex-col relative">
      {/* Settings drawer (overlays everything) */}
      {showSettings && settings.mode !== undefined && (
        <SettingsDrawer
          currentMode={settings.mode}
          currentApiKey={settings.apiKey}
          notionToken={settings.notionToken}
          notionWorkspace={settings.notionWorkspace}
          onSave={saveSettings}
          onConnectNotion={handleConnectNotion}
          onDisconnectNotion={handleDisconnectNotion}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Header — brand row */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <button
          onClick={handleCancelSelection}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          aria-label="Go to home"
        >
          <img src="/logo.png" alt="Alucify" className="w-7 h-7 shrink-0 object-contain" />
          <span className="text-base font-bold text-gray-900 tracking-tight">Alucify</span>
        </button>

        {/* Gear */}
        <button
          onClick={() => setShowSettings(true)}
          className="shrink-0 text-gray-400 hover:text-gray-700 p-1 transition-colors"
          aria-label="Open settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Status row — page detection + mode */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 bg-gray-50">
        <button
          onClick={refreshPage}
          className={`text-xs px-2 py-0.5 rounded-full border truncate text-left transition-colors ${source ? "text-green-600 bg-green-50 border-green-200 hover:bg-green-100" : "text-gray-400 bg-white border-gray-200 hover:bg-gray-100"}`}
          title="Re-detect page"
        >
          {source === "notion" && "Notion Page Detected"}
          {source === "google-docs" && "Google Docs Detected"}
          {!source && "Page Not Detected"}
        </button>
        {settings.mode === "local" && (
          <span className="shrink-0 text-xs px-2 py-0.5 rounded-full border text-purple-600 bg-purple-50 border-purple-200">
            Local
          </span>
        )}
        {settings.mode === "remote" && (
          <span className="shrink-0 text-xs px-2 py-0.5 rounded-full border text-gray-500 bg-white border-gray-200">
            Remote
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1">
        {step === "onboarding" && (
          <OnboardingScreen onComplete={handleOnboardingComplete} />
        )}

        {step === "idle" && (
          <div className="flex flex-col">
            <RunCheckButton onClick={handleRun} disabled={!source} />
            <div className="px-4 pb-4 flex justify-center">
              <label className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer transition-colors">
                Load results JSON
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleLoadJson}
                />
              </label>
            </div>
          </div>
        )}

        {step === "repo_selection" && (
          <RepoSelector
            state={repo}
            onPick={pickAndRead}
            onUseStored={useStoredRepo}
            onClear={clearSelection}
          />
        )}

        {step === "selection_review" && (
          <div className="p-4 flex flex-col gap-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Selected text
              </p>
              <p className="text-sm text-gray-700 italic line-clamp-2">
                "{pendingSelection.slice(0, 80)}{pendingSelection.length > 80 ? "..." : ""}"
              </p>
            </div>
            <RepoSelector
              state={repo}
              onPick={pickAndRead}
              onUseStored={useStoredRepo}
              onClear={clearSelection}
            />
          </div>
        )}

        {step === "running" && (
          <ProgressStates stage={analysis.stage} stageLabel={analysis.stageLabel} />
        )}

        {step === "results" && analysis.result && (
          <ResultsPanel
            result={analysis.result}
            notionPageId={pageId}
            onReset={handleReset}
            onIssueExpand={handleIssueExpand}
            onResultsViewed={handleResultsViewed}
          />
        )}

        {step === "error" && (
          <div className="p-6 flex flex-col items-center gap-4">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-sm text-gray-700 text-center">{analysis.error}</p>
            <button onClick={handleReset} className="text-sm text-brand-600 hover:underline">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
