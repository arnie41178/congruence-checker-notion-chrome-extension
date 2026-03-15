import { useState, useEffect } from "react";

export type PageSource = "notion" | "google-docs" | null;

function detectSource(url: string | undefined): PageSource {
  if (!url) return null;
  if (url.startsWith("https://www.notion.so")) return "notion";
  if (url.startsWith("https://docs.google.com")) return "google-docs";
  return null;
}

export function useNotionPage() {
  const [pageId, setPageId] = useState<string | null>(null);
  const [source, setSource] = useState<PageSource>(null);

  const queryActiveTab = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      const detectedSource = detectSource(url);
      setSource(detectedSource);

      if (!detectedSource) {
        chrome.storage.local.remove(["currentNotionPageId", "currentPrdText"]);
        setPageId(null);
        return;
      }
      chrome.storage.local.get("currentNotionPageId", (result) => {
        if (result.currentNotionPageId) {
          setPageId(result.currentNotionPageId as string);
        }
      });
    });
  };

  useEffect(() => {
    queryActiveTab();

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.currentNotionPageId) {
        setPageId(changes.currentNotionPageId.newValue ?? null);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  return { pageId, source, refresh: queryActiveTab };
}
