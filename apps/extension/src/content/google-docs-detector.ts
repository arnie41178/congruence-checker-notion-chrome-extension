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

async function detect() {
  const pageId = getGoogleDocsPageId();

  console.log("[Alucify] Google Docs detect()", { pageId, url: location.href });

  if (!pageId) return;

  let prdText = "";
  try {
    prdText = await extractGoogleDocsText(pageId);
  } catch (err) {
    console.warn("[Alucify] Google Docs extraction failed:", err);
    return;
  }

  const wordCount = countWords(prdText);
  console.log("[Alucify] Google Docs extracted", wordCount, "words,", prdText.length, "chars");

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
    const pageId = getGoogleDocsPageId();
    if (!pageId) {
      sendResponse({ prdText: "", wordCount: 0 });
      return true;
    }
    extractGoogleDocsText(pageId)
      .then((prdText) => {
        sendResponse({ prdText, wordCount: countWords(prdText) });
      })
      .catch((err) => {
        console.warn("[Alucify] GET_PRD_TEXT extraction failed:", err);
        sendResponse({ prdText: "", wordCount: 0 });
      });
  }
  return true; // keep channel open for async response
});

// Google Docs is an SPA — run on load and re-run on navigation
detect();

let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(detect, 2000);
  }
});

observer.observe(document.body, { childList: true, subtree: true });
