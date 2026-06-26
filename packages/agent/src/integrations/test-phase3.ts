/**
 * Phase 3 test — Google Sheets integration.
 *
 * Always tests:
 *   - graceful skip when env vars are absent
 *   - applied route still responds correctly with no Sheets credentials
 *
 * Also tests live if GOOGLE_SHEETS_SPREADSHEET_ID + GOOGLE_SERVICE_ACCOUNT_JSON are set.
 */
import "dotenv/config";
import express from "express";
import { Server } from "http";
import { initSchema } from "../db/schema";
import { pool } from "../db/pool";
import { updateAppliedJob } from "../db/queries";
import apiRouter from "../api/index";

let passed = 0;
let failed = 0;
let server: Server;
let BASE: string;

function ok(label: string, value: boolean) {
  if (value) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function startServer() {
  await initSchema();
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", apiRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      BASE = `http://localhost:${addr.port}/api`;
      resolve();
    });
  });
  console.log(`Server on ${BASE}\n`);
}

async function testGracefulDegradation() {
  console.log("── Graceful skip (no credentials) ──────────────────────────");
  const { appendRow, syncStatusToSheet } = await import("./sheets");

  // Temporarily remove env vars
  const savedSheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const savedCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let threw = false;
  try {
    const result = await appendRow({
      appliedAt: new Date(),
      company: "TestCo",
      jobTitle: "Intern",
      status: "applied",
    });
    ok("appendRow returns null when unconfigured", result === null);
  } catch {
    threw = true;
  }
  ok("appendRow does not throw when unconfigured", !threw);

  threw = false;
  try {
    await syncStatusToSheet(5, "interviewing");
    ok("syncStatusToSheet resolves when unconfigured", true);
  } catch {
    threw = true;
    ok("syncStatusToSheet resolves when unconfigured", false);
  }
  ok("syncStatusToSheet does not throw when unconfigured", !threw);

  // Restore
  if (savedSheetId) process.env.GOOGLE_SHEETS_SPREADSHEET_ID = savedSheetId;
  if (savedCreds) process.env.GOOGLE_SERVICE_ACCOUNT_JSON = savedCreds;
}

async function testAppliedRouteWithoutSheets() {
  console.log("\n── Applied route works without Sheets credentials ───────────");
  const savedSheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const savedCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  const { status, body } = await api("POST", "/applied", {
    company: "SheetsTest Corp",
    jobTitle: "Phase 3 Intern",
    location: "Remote",
    status: "applied",
  });
  ok("POST /applied returns 201", status === 201);
  ok("row has id", typeof body?.id === "string");
  ok("sheets_row is null (no sync)", body?.sheets_row === null);

  const patch = await api("PATCH", `/applied/${body?.id}`, { status: "interviewing" });
  ok("PATCH /applied/:id returns 200", patch.status === 200);
  ok("status updated in DB", patch.body?.status === "interviewing");

  // Wait a tick for background Sheets call (which should silently skip)
  await new Promise((r) => setTimeout(r, 200));

  // Cleanup
  if (body?.id) await pool.query("DELETE FROM applied_jobs WHERE id = $1", [body.id]);
  ok("cleanup done", true);

  if (savedSheetId) process.env.GOOGLE_SHEETS_SPREADSHEET_ID = savedSheetId;
  if (savedCreds) process.env.GOOGLE_SERVICE_ACCOUNT_JSON = savedCreds;
}

async function testLiveSheets() {
  const sheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!sheetId || !credJson) {
    console.log("\n── Live Sheets test ─────────────── SKIPPED (no credentials)");
    console.log("  To run: set GOOGLE_SHEETS_SPREADSHEET_ID + GOOGLE_SERVICE_ACCOUNT_JSON in .env");
    return;
  }

  console.log("\n── Live Sheets test ────────────────────────────────────────");
  const { appendRow, syncStatusToSheet } = await import("./sheets");

  // appendRow
  const rowNum = await appendRow({
    appliedAt: new Date(),
    company: "Live Test Co",
    jobTitle: "Phase 3 Live Test",
    location: "Remote",
    jobUrl: "https://example.com",
    status: "applied",
    resumeLink: "https://example.com/resume/test",
  });
  ok("appendRow returns a row number", typeof rowNum === "number" && rowNum > 0);
  console.log(`  → wrote to sheet row ${rowNum}`);

  // syncStatusToSheet
  if (rowNum) {
    let threw = false;
    try {
      await syncStatusToSheet(rowNum, "interviewing");
    } catch {
      threw = true;
    }
    ok("syncStatusToSheet does not throw", !threw);
    console.log(`  → updated row ${rowNum} status to 'interviewing'`);
  }

  // Full flow: POST /applied → Sheets sync → sheetsRow stored in DB
  const { status, body } = await api("POST", "/applied", {
    company: "Full Flow Corp",
    jobTitle: "E2E Phase 3 Test",
    location: "NYC",
    jobUrl: "https://example.com/jobs/e2e",
    status: "applied",
  });
  ok("POST /applied returns 201", status === 201);

  // Give background sync time to complete
  await new Promise((r) => setTimeout(r, 3000));

  const { rows } = await pool.query("SELECT sheets_row FROM applied_jobs WHERE id = $1", [body?.id]);
  ok("sheets_row stored after background sync", rows[0]?.sheets_row > 0);
  console.log(`  → sheets_row stored as ${rows[0]?.sheets_row}`);

  if (body?.id) await pool.query("DELETE FROM applied_jobs WHERE id = $1", [body.id]);
  ok("cleanup done", true);
}

async function main() {
  await startServer();
  await testGracefulDegradation();
  await testAppliedRouteWithoutSheets();
  await testLiveSheets();

  console.log(`\n${"─".repeat(55)}`);
  console.log(`PASSED: ${passed}   FAILED: ${failed}`);

  server.close();
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
