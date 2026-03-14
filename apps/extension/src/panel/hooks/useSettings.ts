import { useState, useEffect, useCallback } from "react";

export type AnalysisMode = "remote" | "local";

export interface SettingsState {
  mode: AnalysisMode | undefined; // undefined = never saved (first-run)
  apiKey: string;
  loaded: boolean;
}

export function useSettings() {
  const [state, setState] = useState<SettingsState>({
    mode: undefined,
    apiKey: "",
    loaded: false,
  });

  useEffect(() => {
    chrome.storage.local.get(["alucify_mode", "alucify_api_key"], (result) => {
      setState({
        mode: (result.alucify_mode as AnalysisMode) ?? undefined,
        apiKey: (result.alucify_api_key as string) ?? "",
        loaded: true,
      });
    });
  }, []);

  const save = useCallback(async (mode: AnalysisMode, apiKey: string) => {
    if (mode === "remote") {
      await chrome.storage.local.remove("alucify_api_key");
      await chrome.storage.local.set({ alucify_mode: "remote" });
      setState((s) => ({ ...s, mode: "remote", apiKey: "" }));
    } else {
      await chrome.storage.local.set({ alucify_mode: "local", alucify_api_key: apiKey });
      setState((s) => ({ ...s, mode: "local", apiKey }));
    }
  }, []);

  return { state, save };
}
