#!/usr/bin/env node
/**
 * Alucify Companion — Native Messaging Host Installer
 *
 * Registers com.alucify.companion with Chrome's native messaging registry
 * so the Alucify extension can communicate with the claude CLI on your machine.
 *
 * Usage:
 *   alucify-companion install --extension-id=YOUR_CHROME_EXTENSION_ID
 *
 * To find your extension ID:
 *   1. Open Chrome → chrome://extensions
 *   2. Enable "Developer mode"
 *   3. Copy the ID shown under the Alucify extension
 */

"use strict";

const { writeFileSync, mkdirSync, chmodSync } = require("fs");
const { join, dirname } = require("path");
const { homedir, platform } = require("os");

const HOST_NAME = "com.alucify.companion";

// ── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isInstall = args[0] === "install";
const extensionIdArg = args.find((a) => a.startsWith("--extension-id="))?.split("=")[1];

if (!isInstall) {
  console.log("Usage: alucify-companion install --extension-id=YOUR_EXTENSION_ID");
  process.exit(0);
}

// ── Write launcher with absolute node path ────────────────────────────────────
//
// Chrome spawns native messaging hosts with a minimal PATH that does NOT include
// nvm or homebrew. "#!/usr/bin/env node" fails silently and Chrome reports
// "Native host has exited." before Node.js ever runs.
//
// Fix: generate a thin companion-launcher.js whose shebang is the absolute path
// to the currently-running node binary. No PATH lookup needed.

const nodeBin = process.execPath;          // e.g. ~/.nvm/versions/node/v24.x/bin/node
const nodeBinDir = dirname(nodeBin);       // the directory containing node AND claude
const companionScript = require.resolve("./companion.js");
const launcherPath = join(dirname(companionScript), "companion-launcher.js");

// The launcher:
//  1. Prepends the nvm bin dir to PATH so spawnSync("claude",...) resolves.
//  2. Requires companion.js which does the actual native messaging work.
const launcherContent = [
  `#!${nodeBin}`,
  `process.env.PATH = ${JSON.stringify(nodeBinDir)} + ":" + (process.env.PATH || "");`,
  `require(${JSON.stringify(companionScript)});`,
  "",
].join("\n");

writeFileSync(launcherPath, launcherContent, "utf-8");
chmodSync(launcherPath, 0o755);

// ── Build manifest ────────────────────────────────────────────────────────────

const extensionId = extensionIdArg ?? "__EXTENSION_ID__";
const manifest = {
  name: HOST_NAME,
  description: "Alucify companion — routes Claude CLI calls from the Chrome extension",
  path: launcherPath,
  type: "stdio",
  allowed_origins: [
    `chrome-extension://${extensionId}/`,
  ],
};

// ── Determine install path by platform ───────────────────────────────────────

const os = platform();
let destPath;

if (os === "darwin") {
  destPath = join(
    homedir(),
    "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    `${HOST_NAME}.json`
  );
} else if (os === "linux") {
  destPath = join(
    homedir(),
    ".config/google-chrome/NativeMessagingHosts",
    `${HOST_NAME}.json`
  );
} else if (os === "win32") {
  console.log("Windows installation requires a registry entry.");
  console.log("Add the following registry key:");
  console.log(`  HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`);
  console.log(`  Default value: <path to ${HOST_NAME}.json>`);
  console.log("\nManifest content to save as a .json file:");
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
} else {
  console.error(`Unsupported platform: ${os}`);
  process.exit(1);
}

// ── Write manifest ────────────────────────────────────────────────────────────

mkdirSync(dirname(destPath), { recursive: true });
writeFileSync(destPath, JSON.stringify(manifest, null, 2), "utf-8");

console.log(`[alucify-companion] Launcher:  ${launcherPath}`);
console.log(`[alucify-companion] Node:      ${nodeBin}`);
console.log(`[alucify-companion] Manifest:  ${destPath}`);
console.log(`[alucify-companion] Extension: ${extensionId}`);

if (!extensionIdArg) {
  console.warn(
    "\n⚠️  Extension ID not provided — using placeholder.\n" +
    "   Re-run with your real extension ID:\n" +
    "   alucify-companion install --extension-id=YOUR_EXTENSION_ID"
  );
}
