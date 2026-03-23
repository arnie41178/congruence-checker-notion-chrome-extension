import { useState, useCallback, useRef } from "react";
import type { JobState, AnalysisResult, RepoContext } from "@alucify/shared-types";

export type AnalysisPhase = "idle" | "running" | "results" | "error";

export interface AnalysisState {
  phase: AnalysisPhase;
  jobId: string | null;
  stage: number;
  stageLabel: string;
  result: AnalysisResult | null;
  error: string | null;
}

const INITIAL: AnalysisState = {
  phase: "idle",
  jobId: null,
  stage: 0,
  stageLabel: "",
  result: null,
  error: null,
};

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 2700; // 90-minute timeout (pipeline with 5 Opus runs takes 30-60 min)

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startAnalysis = useCallback(async (notionPageId: string, repo?: RepoContext, prdText?: string) => {
    setState({ ...INITIAL, phase: "running", stage: 1, stageLabel: "Extracting PRD intent..." });

    try {
      const response = await chrome.runtime.sendMessage({
        type: "START_ANALYSIS",
        notionPageId,
        repo,
        ...(prdText ? { prdText } : {}),
      }) as { jobId: string } | { error: string };

      if ("error" in response) throw new Error(response.error);

      const { jobId } = response;
      if (!jobId) throw new Error("Analysis failed to start — no job ID returned.");
      setState((s) => ({ ...s, jobId }));

      let pollCount = 0;
      pollRef.current = setInterval(async () => {
        if (++pollCount > MAX_POLLS) {
          stopPolling();
          setState((s) => ({ ...s, phase: "error", error: "Analysis timed out after 90 minutes." }));
          return;
        }
        try {
          const job = await chrome.runtime.sendMessage({
            type: "GET_JOB_STATUS",
            jobId,
          }) as JobState;

          if (!job.status) {
            stopPolling();
            setState((s) => ({ ...s, phase: "error", error: "Job not found. It may have expired." }));
            return;
          }
          if (job.status === "running") {
            setState((s) => ({
              ...s,
              stage: job.stage ?? s.stage,
              stageLabel: job.stageLabel ?? s.stageLabel,
            }));
          } else if (job.status === "completed" && job.result) {
            stopPolling();
            setState((s) => ({ ...s, phase: "results", result: job.result! }));
          } else if (job.status === "failed") {
            stopPolling();
            setState((s) => ({ ...s, phase: "error", error: job.message ?? "Analysis failed." }));
          }
        } catch (err) {
          stopPolling();
          setState((s) => ({ ...s, phase: "error", error: String(err) }));
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setState((s) => ({ ...s, phase: "error", error: String(err) }));
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setState(INITIAL);
  }, []);

  const loadResult = useCallback((result: AnalysisResult) => {
    stopPolling();
    setState({ ...INITIAL, phase: "results", result });
  }, []);

  return { state, startAnalysis, reset, loadResult };
}
