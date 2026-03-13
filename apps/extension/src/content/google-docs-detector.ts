// Runs on docs.google.com pages — detects PRD documents and notifies the background SW.
import { extractGoogleDocsText } from "../lib/google-docs-extractor";

function getGoogleDocsPageId(): string | null {
  // URL pattern: /document/d/{docId}/edit
  const match = location.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isDocumentPage(): boolean {
  return (
    !!document.querySelector(".kix-appview-editor") ||
    !!document.querySelector(".kix-paragraphrenderer") ||
    !!document.querySelector(".docs-editor-container")
  );
}

function detect() {
  const isDoc = isDocumentPage();
  const pageId = getGoogleDocsPageId();

  console.log("[Alucify] Google Docs detect()", { isDoc, pageId, url: location.href });

  if (!isDoc || !pageId) return;

  const prdText = extractGoogleDocsText();
  const wordCount = countWords(prdText);

  chrome.runtime.sendMessage(
    { type: "NOTION_PAGE_DETECTED", pageId, wordCount, prdText },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Alucify] sendMessage failed:", chrome.runtime.lastError.message, "— retrying in 2s");
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: "NOTION_PAGE_DETECTED", pageId, wordCount, prdText });
        }, 2000);
      } else {
        console.log("[Alucify] sendMessage ok:", response);
      }
    }
  );
}

// Handle on-demand extraction requests from the service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_PRD_TEXT") {
    const prdText = extractGoogleDocsText();
    const wordCount = countWords(prdText);
    sendResponse({ prdText, wordCount });
  }
  return true;
});

// Google Docs is an SPA — run on load and re-run on navigation
detect();

let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(detect, 2000); // Google Docs takes longer to render than Notion
  }
});

observer.observe(document.body, { childList: true, subtree: true });
