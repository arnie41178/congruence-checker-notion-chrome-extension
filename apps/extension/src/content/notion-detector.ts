// Runs on notion.so pages — detects PRD pages and notifies the background SW

function getNotionPageId(): string | null {
  // Notion URLs: /Page-Title-<32hex> or /workspace/Page-Title-<32hex>
  // Also handle UUIDs with dashes: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const path = location.pathname;
  const match =
    path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/) ??
    path.match(/([0-9a-f]{32})(?:[?#]|$)/i);
  return match ? match[1] : null;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isDocumentPage(): boolean {
  // Try multiple signals — Notion renders async so check broadly
  return (
    !!document.querySelector('[contenteditable="true"]') ||
    !!document.querySelector(".notion-page-content") ||
    !!document.querySelector(".notion-scroller")
  );
}

function getPageText(): string {
  const content = document.querySelector(".notion-page-content");
  return content?.textContent ?? document.body.innerText;
}

function detect() {
  const isDoc = isDocumentPage();
  const pageId = getNotionPageId();
  const wordCount = countWords(getPageText());

  console.log("[Alucify] detect()", { isDoc, pageId, wordCount, url: location.href });

  if (!isDoc || !pageId) return;

  chrome.runtime.sendMessage(
    { type: "NOTION_PAGE_DETECTED", pageId, wordCount },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Alucify] sendMessage failed:", chrome.runtime.lastError.message, "— retrying in 2s");
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: "NOTION_PAGE_DETECTED", pageId, wordCount });
        }, 2000);
      } else {
        console.log("[Alucify] sendMessage ok:", response);
      }
    }
  );
}

// Run on load and re-run when Notion navigates (SPA)
detect();

let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(detect, 1500); // let Notion render the new page
  }
});

observer.observe(document.body, { childList: true, subtree: true });
