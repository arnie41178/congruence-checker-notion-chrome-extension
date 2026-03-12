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

const POLL_INTERVAL_MS = 1000;

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(INITIAL);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startAnalysis = useCallback(async (notionPageId: string, repo?: RepoContext) => {
    setState({ ...INITIAL, phase: "running", stage: 1, stageLabel: "Extracting PRD intent..." });

    try {
      const response = await chrome.runtime.sendMessage({
        type: "START_ANALYSIS",
        notionPageId,
        repo,
      }) as { jobId: string } | { error: string };

      if ("error" in response) throw new Error(response.error);

      const { jobId } = response;
      setState((s) => ({ ...s, jobId }));

      pollRef.current = setInterval(async () => {
        try {
          const job = await chrome.runtime.sendMessage({
            type: "GET_JOB_STATUS",
            jobId,
          }) as JobState;

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

  return { state, startAnalysis, reset };
}
