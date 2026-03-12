import { useState, useEffect } from "react";

export function useNotionPage() {
  const [pageId, setPageId] = useState<string | null>(null);

  useEffect(() => {
    chrome.storage.local.get("currentNotionPageId", (result) => {
      if (result.currentNotionPageId) {
        setPageId(result.currentNotionPageId as string);
      }
    });

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.currentNotionPageId?.newValue) {
        setPageId(changes.currentNotionPageId.newValue as string);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  return pageId;
}
