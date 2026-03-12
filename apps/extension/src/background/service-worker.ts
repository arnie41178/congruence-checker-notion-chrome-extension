import { getOrCreateClientId } from "../lib/client-id";
import { initTelemetry, track } from "../lib/telemetry";
import type { RepoContext } from "@alucify/shared-types";

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
      const { pageId, wordCount } = message as { type: string; pageId: string; wordCount: number };
      track("extension_notion_page_detected", { notionPageId: pageId, wordCount });
      if (wordCount > 200) {
        track("prd_page_detected", { notionPageId: pageId, wordCount });
      }
      await chrome.storage.local.set({ currentNotionPageId: pageId });
      return { ok: true };
    }

    case "START_ANALYSIS": {
      const { notionPageId, repo } = message as { type: string; notionPageId: string; repo?: RepoContext };
      track("run_congruence_check_clicked", { notionPageId });
      const jobId = await startAnalysis(clientId, notionPageId, repo);
      track("analysis_started", { notionPageId, jobId });
      return { jobId };
    }

    case "GET_JOB_STATUS": {
      const { jobId } = message as { type: string; jobId: string };
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
  repo?: RepoContext
): Promise<string> {
  const body = {
    notionPageId,
    prdText: "",
    repo: repo ?? { name: "mock", files: [], meta: { totalFiles: 0, totalChars: 0 } },
  };
  const res = await fetch(`${API_BASE}/analysis/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-ID": clientId },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { jobId: string };
  return data.jobId;
}

async function pollJob(clientId: string, jobId: string) {
  const res = await fetch(`${API_BASE}/analysis/${jobId}`, {
    headers: { "X-Client-ID": clientId },
  });
  return res.json();
}
