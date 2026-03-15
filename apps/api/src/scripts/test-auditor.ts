/**
 * Standalone test for prd-auditor.md prompt output.
 * Run with: pnpm tsx src/scripts/test-auditor.ts
 *
 * Validates that the LLM produces the expected ## Scorecard JSON block.
 */

import { runPrdAudit } from "../services/prd-auditor.service.js";
import { auditReportToIssues, scorecardFromReport } from "../services/prd-auditor.service.js";
import type { PrdEntities } from "../prompts/prd-extraction.prompt.js";
import type { RepoIndex } from "../services/repo-indexer.js";

// ── Sample PRD ────────────────────────────────────────────────────────────────

const SAMPLE_PRD = `
# Feature: User Authentication

## Overview
Users can sign up and log in using email and password. Passwords are hashed
using bcrypt before storage. Sessions are managed via JWT tokens.

## Requirements
- REQ-1: User registration with email + password
- REQ-2: Login returns a JWT valid for 24 hours
- REQ-3: Passwords must be at least 8 characters
- REQ-4: Email must be unique per account
- REQ-5: Logout invalidates the token

## API Endpoints
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout

## Acceptance Criteria
- AC-1: Registration fails if email already exists (409)
- AC-2: Login fails with invalid credentials (401)
- AC-3: Authenticated routes return 401 without a valid token
`;

// ── Sample PRD Entities ───────────────────────────────────────────────────────

const SAMPLE_ENTITIES: PrdEntities = {
  entities: ["User", "Session", "Token"],
  apiEndpoints: ["/api/auth/register", "/api/auth/login", "/api/auth/logout"],
  userFlows: ["Registration", "Login", "Logout"],
  techRequirements: ["bcrypt", "JWT"],
  integrations: [],
};

// ── Sample Repo Index ─────────────────────────────────────────────────────────

const SAMPLE_REPO: RepoIndex = {
  fileCount: 8,
  fileTree: `
src/
  routes/
    auth.ts          ← POST /api/auth/login, POST /api/auth/register
  services/
    auth.service.ts
  models/
    user.model.ts    ← { id, email, passwordHash, createdAt }
  middleware/
    authenticate.ts  ← verifies JWT from Authorization header
  app.ts
`.trim(),
  routes: [
    "POST /api/auth/login",
    "POST /api/auth/register",
  ],
  models: ["src/models/user.model.ts"],
  services: ["src/services/auth.service.ts"],
  keyFileContents: `
// src/routes/auth.ts (excerpt)
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await UserModel.findByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: "24h" });
  res.json({ token });
});

// NOTE: /api/auth/logout route is NOT implemented in the codebase
`,
};

// ── Run ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Running PRD audit with sample data…\n");

  const report = await runPrdAudit(SAMPLE_PRD, SAMPLE_ENTITIES, SAMPLE_REPO);

  console.log("=".repeat(60));
  console.log("FULL REPORT");
  console.log("=".repeat(60));
  console.log(report);
  console.log("=".repeat(60));

  // Check scorecard
  const scorecard = scorecardFromReport(report);
  if (scorecard) {
    console.log("\n✅ Scorecard parsed successfully!");
    console.log(`   Overall score: ${scorecard.overallScore}/10`);
    console.log(`   Summary: ${scorecard.overallSummary}`);
    console.log(`   Categories: ${Object.entries(scorecard.categories).map(([k, v]) => `${k}=${v.score}`).join(", ")}`);
  } else {
    console.log("\n❌ No scorecard block found in report.");
    console.log("   Last 500 chars of report:");
    console.log(report.slice(-500));
  }

  // Check issues + new fields
  const issues = auditReportToIssues(report);
  console.log(`\n📋 Issues parsed: ${issues.length}\n`);
  issues.forEach((issue, idx) => {
    console.log(`--- Issue ${idx + 1} [${issue.impact.toUpperCase()}] ---`);
    console.log(`  Title:      ${issue.summary}`);
    console.log(`  Suggestion: ${issue.suggestion ?? "❌ MISSING"}`);
    if (issue.diffs && issue.diffs.length > 0) {
      console.log(`  Diffs (${issue.diffs.length} hunk${issue.diffs.length > 1 ? "s" : ""}):`);
      issue.diffs.forEach((hunk, hi) => {
        console.log(`    [${hi + 1}] Section: "${hunk.sectionTitle}"`);
        console.log(`        Before: ${hunk.before ? hunk.before.slice(0, 120).replace(/\n/g, " ↵ ") : "(pure addition)"}`);
        console.log(`        After:  ${hunk.after.slice(0, 120).replace(/\n/g, " ↵ ")}`);
      });
    } else {
      console.log(`  Diffs:      ❌ MISSING`);
    }
    console.log();
  });
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
