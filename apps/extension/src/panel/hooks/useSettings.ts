import { useState, useEffect, useCallback } from "react";

export type AnalysisMode = "remote" | "local";

export interface SettingsState {
  mode: AnalysisMode | undefined; // undefined = never saved (first-run)
  apiKey: string;
  notionToken: string;
  notionWorkspace: string;
  loaded: boolean;
}

export function useSettings() {
  const [state, setState] = useState<SettingsState>({
    mode: undefined,
    apiKey: "",
    notionToken: "",
    notionWorkspace: "",
    loaded: false,
  });

  useEffect(() => {
    chrome.storage.local.get(["alucify_mode", "alucify_api_key", "alucify_notion_token", "alucify_notion_workspace"], (result) => {
      setState({
        mode: (result.alucify_mode as AnalysisMode) ?? undefined,
        apiKey: (result.alucify_api_key as string) ?? "",
        notionToken: (result.alucify_notion_token as string) ?? "",
        notionWorkspace: (result.alucify_notion_workspace as string) ?? "",
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

  const saveNotionConnection = useCallback(async (token: string, workspace: string) => {
    await chrome.storage.local.set({ alucify_notion_token: token, alucify_notion_workspace: workspace });
    setState((s) => ({ ...s, notionToken: token, notionWorkspace: workspace }));
  }, []);

  const clearNotionConnection = useCallback(async () => {
    await chrome.storage.local.remove(["alucify_notion_token", "alucify_notion_workspace"]);
    setState((s) => ({ ...s, notionToken: "", notionWorkspace: "" }));
  }, []);

  return { state, save, saveNotionConnection, clearNotionConnection };
}
