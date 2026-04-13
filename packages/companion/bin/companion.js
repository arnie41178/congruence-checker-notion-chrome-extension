#!/usr/bin/env node
/**
 * Alucify Native Messaging Host + CLI
 *
 * Usage:
 *   alucify-companion install --extension-id=YOUR_ID   # register with Chrome
 *   (spawned by Chrome)                                 # native messaging host mode
 */

"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");

function log(msg) {
  fs.appendFileSync("/tmp/alucify-companion.log", new Date().toISOString() + " " + msg + "\n");
}

// ── CLI subcommand routing ────────────────────────────────────────────────────
// When Chrome spawns this as a native messaging host, it passes the extension
// origin as argv[2] (e.g. "chrome-extension://abc.../"). When the user runs
// "alucify-companion install ...", argv[2] is "install".
log("companion started, argv=" + JSON.stringify(process.argv.slice(2)));

if (process.argv[2] === "install") {
  require("./install.js");
  process.exit(0);
}

// ── Native messaging I/O helpers ──────────────────────────────────────────────

function writeMessage(msg) {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

// ── Read one length-prefixed message from stdin (buffer accumulation) ─────────

function readOneMessage() {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);

    function tryParse() {
      // Need at least 4 bytes for the length header
      if (buf.length < 4) return;
      const msgLen = buf.readUInt32LE(0);
      // Need header + body
      if (buf.length < 4 + msgLen) return;

      const body = buf.slice(4, 4 + msgLen);
      try {
        resolve(JSON.parse(body.toString("utf-8")));
      } catch (e) {
        reject(new Error("Failed to parse message JSON: " + e.message));
      }
    }

    process.stdin.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      tryParse();
    });

    process.stdin.on("error", reject);
    process.stdin.on("end", () => {
      if (buf.length === 0) reject(new Error("stdin closed with no data"));
      else reject(new Error("stdin ended before full message received"));
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log("waiting for message from Chrome...");
  let message;
  try {
    message = await readOneMessage();
    log("message received, prompt length=" + (message.prompt?.length ?? 0));
  } catch (err) {
    log("readOneMessage error: " + err.message);
    writeMessage({ error: "Failed to read message: " + err.message });
    process.exit(1);
  }

  const { system, prompt, model = "claude-haiku-4-5-20251001" } = message;

  if (!prompt) {
    log("missing prompt field");
    writeMessage({ error: "Missing required field: prompt" });
    process.exit(1);
  }

  const args = [
    "--print",
    "--dangerously-skip-permissions",
    "--model", model,
  ];

  if (system) {
    args.push("--system-prompt", system);
  }

  args.push(prompt);

  // Build a clean env: inherit everything but strip CLAUDECODE so that Claude
  // CLI can be spawned even when the companion is launched from within a
  // Claude Code session (e.g. during development / testing).
  const env = { ...process.env };
  delete env.CLAUDECODE;

  log("spawning claude with model=" + model);
  const result = spawnSync("claude", args, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env,
    timeout: 120_000,
  });

  if (result.error) {
    log("spawn error: " + result.error.message);
    writeMessage({ error: "Failed to spawn claude CLI: " + result.error.message + ". Is claude installed?" });
    process.exit(1);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").slice(0, 500);
    log("claude non-zero exit: " + result.status + " stderr=" + stderr);
    writeMessage({ error: "claude exited with code " + result.status + ": " + stderr });
    process.exit(1);
  }

  log("claude succeeded, response length=" + (result.stdout?.length ?? 0));
  writeMessage({ text: result.stdout ?? "" });
  process.exit(0);
}

main().catch((err) => {
  writeMessage({ error: String(err) });
  process.exit(1);
});
