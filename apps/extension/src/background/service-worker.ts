import { getOrCreateClientId } from "../lib/client-id";
import { initTelemetry, track } from "../lib/telemetry";
import { runLocalPipeline } from "../lib/local-pipeline";
import type { RepoContext } from "@alucify/shared-types";

// ── Local job store (in-memory, lives as long as SW is alive) ─────────────────
interface LocalJobState {
  jobId: string;
  status: "running" | "completed" | "failed";
  stage?: number;
  stageLabel?: string;
  result?: unknown;
  message?: string;
}
const localJobs = new Map<string, LocalJobState>();

const API_BASE = (self as unknown as { VITE_API_BASE?: string }).VITE_API_BASE
  ?? "http://localhost:3001";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  const clientId = await getOrCreateClientId();
  initTelemetry(clientId);
  return clientId;
}

let clientIdPromise = bootstrap();

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await clientIdPromise;
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    track("extension_installed");
    await chrome.storage.local.set({ alucify_first_install: true });
  }
  // Open side panel when action icon is clicked
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Register context menu item for Notion selection review
  chrome.contextMenus.create({
    id: "alucify-technical-review",
    title: "Technical Review",
    contexts: ["selection"],
    documentUrlPatterns: ["https://www.notion.so/*"],
  });
});

// ── Context menu ───────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "alucify-technical-review" || !tab?.windowId) return;
  chrome.storage.local.set({ pendingSelection: info.selectionText ?? "" });
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Message handling ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[Alucify SW] Message received:", message.type);
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error("[Alucify SW] Message error:", err);
    sendResponse({ error: String(err) });
  });
  return true; // keep channel open
});

async function handleMessage(message: Record<string, unknown>) {
  const clientId = await clientIdPromise;

  switch (message.type) {
    case "NOTION_PAGE_DETECTED": {
      const { pageId, wordCount, prdText } = message as { type: string; pageId: string; wordCount: number; prdText?: string };
      track("extension_notion_page_detected", { notionPageId: pageId, wordCount });
      if (wordCount > 200) {
        track("prd_page_detected", { notionPageId: pageId, wordCount });
      }
      await chrome.storage.local.set({ currentNotionPageId: pageId, currentPrdText: prdText ?? "" });
      return { ok: true };
    }

    case "START_ANALYSIS": {
      const { notionPageId, repo, prdText: explicitPrdText } = message as { type: string; notionPageId: string; repo?: RepoContext; prdText?: string };
      track("run_congruence_check_clicked", { notionPageId });

      const stored = await chrome.storage.local.get(["currentPrdText", "alucify_mode", "alucify_api_key"]);
      const mode = (stored.alucify_mode as string) ?? "remote";
      const cachedPrdText = (stored.currentPrdText as string) ?? "";

      // If prdText was explicitly passed (e.g. from a selection review), use it directly.
      // Otherwise extract fresh from the active tab, falling back to cached.
      let prdText: string;
      if (explicitPrdText) {
        prdText = explicitPrdText;
      } else {
        prdText = await extractPrdTextFromActiveTab();
        if (prdText.trim().length < 50) {
          prdText = cachedPrdText;
        }
      }
      console.log(`[Alucify SW] START_ANALYSIS mode=${mode} notionPageId=${notionPageId} freshPrdLength=${prdText.length} cachedPrdLength=${cachedPrdText.length} repoFiles=${repo?.files?.map(f => f.path)}`);

      if (mode === "local") {
        const apiKey = (stored.alucify_api_key as string) ?? "";
        if (!apiKey) throw new Error("No API key configured. Open Settings to add your Anthropic API key.");
        const jobId = crypto.randomUUID();
        localJobs.set(jobId, { jobId, status: "running", stage: 1, stageLabel: "Extracting PRD intent..." });
        runLocalPipeline(jobId, notionPageId, prdText, repo ?? { name: "unknown", files: [], meta: { totalFiles: 0, totalChars: 0 } }, apiKey, (progress) => {
          localJobs.set(jobId, { ...localJobs.get(jobId)!, ...progress });
        }).then((result) => {
          localJobs.set(jobId, { jobId, status: "completed", result });
        }).catch((err) => {
          localJobs.set(jobId, { jobId, status: "failed", message: String(err) });
        });
        track("analysis_started", { notionPageId, jobId, prdLength: prdText.length, mode: "local" });
        return { jobId };
      }

      const jobId = await startAnalysis(clientId, notionPageId, prdText, repo);
      track("analysis_started", { notionPageId, jobId, prdLength: prdText.length, mode: "remote" });
      return { jobId };
    }

    case "GET_JOB_STATUS": {
      const { jobId } = message as { type: string; jobId: string };

      // Check local jobs first
      const localJob = localJobs.get(jobId);
      if (localJob) {
        if (localJob.status === "completed") {
          track("analysis_completed", { jobId, issueCount: (localJob.result as { issueCount?: number })?.issueCount, badge: (localJob.result as { badge?: string })?.badge });
        }
        return localJob;
      }

      const status = await pollJob(clientId, jobId);
      if (status.status === "completed") {
        track("analysis_completed", {
          jobId,
          issueCount: status.result?.issueCount,
          badge: status.result?.badge,
        });
      }
      return status;
    }

    case "PANEL_OPENED": {
      const isFirst = await isFirstOpen();
      if (isFirst) track("extension_first_opened");
      track("extension_panel_opened");
      return { ok: true };
    }

    case "PANEL_CLOSED": {
      track("extension_panel_closed");
      return { ok: true };
    }

    case "TRACK": {
      const { event, properties } = message as { type: string; event: string; properties?: Record<string, unknown> };
      track(event as Parameters<typeof track>[0], properties);
      return { ok: true };
    }

    default:
      return { error: "unknown_message_type" };
  }
}

async function isFirstOpen(): Promise<boolean> {
  const result = await chrome.storage.local.get("alucify_first_open_done");
  if (result.alucify_first_open_done) return false;
  await chrome.storage.local.set({ alucify_first_open_done: true });
  return true;
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function startAnalysis(
  clientId: string,
  notionPageId: string,
  prdText: string,
  repo?: RepoContext
): Promise<string> {
  const body = {
    notionPageId,
    prdText,
    repo: repo ?? { name: "mock", files: [], meta: { totalFiles: 0, totalChars: 0 } },
  };
  const res = await fetch(`${API_BASE}/analysis/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-ID": clientId },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const data = (await res.json()) as { jobId: string };
  return data.jobId;
}

async function extractPrdTextFromActiveTab(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return "";

  // First try: send message to content script (if already injected)
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PRD_TEXT" }) as { prdText: string } | undefined;
    const text = response?.prdText ?? "";
    if (text.length > 0) {
      await chrome.storage.local.set({ currentPrdText: text });
      console.log(`[Alucify SW] PRD via content script: ${text.length} chars`);
      return text;
    }
  } catch {
    console.warn("[Alucify SW] Content script not reachable, falling back to executeScript");
  }

  // Fallback: inject script directly into the tab (handles tabs open before extension load)
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const MAX_CHARS = 32_000;
        const blockEls = document.querySelectorAll<HTMLElement>("[data-block-id]");
        const lines: string[] = [];
        if (blockEls.length > 0) {
          for (const el of blockEls) {
            if (el.closest(".notion-sidebar, .notion-topbar, .notion-comments, nav")) continue;
            const text = (el.innerText ?? el.textContent ?? "").trim();
            if (text) lines.push(text);
          }
        } else {
          const container =
            document.querySelector(".notion-page-content") ??
            document.querySelector(".notion-scroller") ??
            document.querySelector("[role='main']") ??
            document.body;
          const text = ((container as HTMLElement).innerText ?? container.textContent ?? "").trim();
          if (text) lines.push(text);
        }
        let result = lines.join("\n").slice(0, MAX_CHARS);
        return result;
      },
    });
    const text = (results?.[0]?.result as string) ?? "";
    if (text.length > 0) {
      await chrome.storage.local.set({ currentPrdText: text });
      console.log(`[Alucify SW] PRD via executeScript: ${text.length} chars`);
    }
    return text;
  } catch (err) {
    console.warn("[Alucify SW] executeScript extraction failed:", err);
    return "";
  }
}

async function pollJob(clientId: string, jobId: string) {
  const res = await fetch(`${API_BASE}/analysis/${jobId}`, {
    headers: { "X-Client-ID": clientId },
  });
  return res.json();
}
