import type { TelemetryEvent, TelemetryProperties } from "@alucify/shared-types";

// PostHog removed temporarily to comply with Chrome Web Store MV3 policy.
// Re-add once a MV3-compatible analytics solution is in place.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initTelemetry(_cid: string): void {}

export function track(event: TelemetryEvent, properties: TelemetryProperties = {}): void {
  console.log(`[Alucify Telemetry] ${event}`, properties);
}
