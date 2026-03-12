import posthog from "posthog-js";
import type { TelemetryEvent, TelemetryProperties } from "@alucify/shared-types";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST as string | undefined ?? "https://app.posthog.com";

let initialized = false;
let clientId: string | null = null;

export function initTelemetry(cid: string): void {
  clientId = cid;
  if (!POSTHOG_KEY) {
    console.warn("[Alucify] PostHog key not set — telemetry disabled");
    return;
  }
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    persistence: "memory",
  });
  posthog.identify(cid, {
    extensionVersion: chrome.runtime.getManifest().version,
  });
  initialized = true;
}

export function track(event: TelemetryEvent, properties: TelemetryProperties = {}): void {
  const base: TelemetryProperties = {
    clientId: clientId ?? "unknown",
    extensionVersion: chrome.runtime.getManifest().version,
    browser: "chrome",
    timestamp: new Date().toISOString(),
    ...properties,
  };

  if (initialized) {
    posthog.capture(event, base);
  } else {
    // Always log so events are visible even without PostHog key
    console.log(`[Alucify Telemetry] ${event}`, base);
  }
}
