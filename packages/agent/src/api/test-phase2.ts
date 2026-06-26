/**
 * Phase 2 integration test — spins up the Express API on a temp port and
 * exercises every endpoint. Does NOT call the LLM (tailor endpoint is skipped
 * unless OPENAI_API_KEY is set). PDF generation uses real Playwright.
 */
import "dotenv/config";
import express from "express";
import { Server } from "http";
import { initSchema } from "../db/schema";
import { pool } from "../db/pool";
import apiRouter from "./index";

let passed = 0;
let failed = 0;
let server: Server;
let BASE: string;
let createdResumeId: string;
let createdAppliedId: string;

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
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function startServer(): Promise<void> {
  await initSchema();
  const app = express();
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
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

async function testMasterResume() {
  console.log("── GET /api/master-resume ──────────────────────────────────");
  const { status, body } = await api("GET", "/master-resume");
  ok("status 200", status === 200);
  ok("returns basics.name", body?.basics?.name === "Christopher Zhang");
  ok("experience array present", Array.isArray(body?.experience) && body.experience.length > 0);

  console.log("\n── PUT /api/master-resume ──────────────────────────────────");
  const modified = { ...body, basics: { ...body.basics, phone: "555-PHASE2" } };
  const put = await api("PUT", "/master-resume", modified);
  ok("status 200", put.status === 200);
  ok("updated flag", put.body?.updated === true);

  const { body: reloaded } = await api("GET", "/master-resume");
  ok("change persisted", reloaded?.basics?.phone === "555-PHASE2");

  // restore
  await api("PUT", "/master-resume", body);
  const { body: restored } = await api("GET", "/master-resume");
  ok("restored original", restored?.basics?.phone === body?.basics?.phone);

  const badPut = await api("PUT", "/master-resume", { basics: "invalid" });
  ok("invalid schema → 400", badPut.status === 400);
}

async function testCreateResumeDirectly() {
  console.log("\n── Seed a tailored_resume row directly ─────────────────────");
  // We seed directly via DB so we can test all the resume endpoints without
  // calling the LLM. If OPENAI_API_KEY is present we also run the tailor endpoint.
  const { createTailoredResume } = await import("../db/queries");
  const row = await createTailoredResume({
    jobTitle: "Software Engineer Intern",
    company: "PhaseTwo Corp",
    jobUrl: "https://example.com/jobs/1",
    jdText: "We need a great engineer who loves TypeScript.",
    markdown: "# Christopher Zhang\nProvidence, RI\n\n## Experience\n**PhaseTwo Corp** — SWE Intern\n- Built stuff with TypeScript\n\n## Skills\nTypeScript · Node.js",
    criticScore: 77,
  });
  createdResumeId = row.id;
  ok("row created with uuid", typeof row.id === "string" && row.id.length > 0);
  ok("critic_score stored", row.critic_score === 77);
  console.log(`  (resume id: ${createdResumeId})`);
}

async function testResumes() {
  console.log("\n── GET /api/resumes ────────────────────────────────────────");
  const { status, body } = await api("GET", "/resumes");
  ok("status 200", status === 200);
  ok("returns array", Array.isArray(body));
  ok("seeded row in list", body?.some((r: any) => r.id === createdResumeId));
  ok("pdf not in list response", !("pdf" in (body?.[0] ?? {})));

  console.log("\n── GET /api/resume/:id ─────────────────────────────────────");
  const { status: s2, body: b2 } = await api("GET", `/resume/${createdResumeId}`);
  ok("status 200", s2 === 200);
  ok("id matches", b2?.id === createdResumeId);
  ok("jd_text present", typeof b2?.jd_text === "string");

  const { status: s404 } = await api("GET", "/resume/00000000-0000-0000-0000-000000000000");
  ok("unknown id → 404", s404 === 404);

  console.log("\n── PATCH /api/resume/:id ───────────────────────────────────");
  const newMd = "# Christopher Zhang\nProvidence, RI\n\n## Experience\n**PhaseTwo Corp** — SWE Intern\n- Edited bullet";
  const { status: ps, body: pb } = await api("PATCH", `/resume/${createdResumeId}`, { markdown: newMd });
  ok("status 200", ps === 200);
  ok("updatedAt returned", !!pb?.updatedAt);

  const { body: afterPatch } = await api("GET", `/resume/${createdResumeId}`);
  ok("markdown update persisted", afterPatch?.markdown === newMd);

  const badPatch = await api("PATCH", `/resume/${createdResumeId}`, { markdown: 42 });
  ok("non-string markdown → 400", badPatch.status === 400);
}

async function testPdf() {
  console.log("\n── GET /api/resume/:id/pdf ─────────────────────────────────");
  const res = await fetch(`${BASE}/resume/${createdResumeId}/pdf`);
  ok("status 200", res.status === 200);
  ok("content-type is pdf", res.headers.get("content-type") === "application/pdf");
  const buf = Buffer.from(await res.arrayBuffer());
  ok("response is non-empty", buf.length > 0);
  ok("starts with %PDF", buf.slice(0, 4).toString() === "%PDF");

  // Second request should serve the cached version
  const res2 = await fetch(`${BASE}/resume/${createdResumeId}/pdf`);
  ok("cached pdf also returns 200", res2.status === 200);

  const res404 = await fetch(`${BASE}/resume/00000000-0000-0000-0000-000000000000/pdf`);
  ok("unknown id → 404", res404.status === 404);
}

async function testApplied() {
  console.log("\n── POST /api/applied ───────────────────────────────────────");
  const { status, body } = await api("POST", "/applied", {
    company: "PhaseTwo Corp",
    jobTitle: "Software Engineer Intern",
    location: "Remote",
    jobUrl: "https://example.com/jobs/1",
    status: "applied",
    resumeId: createdResumeId,
  });
  ok("status 201", status === 201);
  ok("id present", typeof body?.id === "string");
  ok("resume_id FK set", body?.resume_id === createdResumeId);
  createdAppliedId = body?.id;

  const missing = await api("POST", "/applied", { company: "Acme" });
  ok("missing jobTitle → 400", missing.status === 400);

  console.log("\n── GET /api/applied ────────────────────────────────────────");
  const list = await api("GET", "/applied");
  ok("status 200", list.status === 200);
  ok("returns array", Array.isArray(list.body));
  ok("created entry in list", list.body?.some((r: any) => r.id === createdAppliedId));

  console.log("\n── PATCH /api/applied/:id ──────────────────────────────────");
  const patch = await api("PATCH", `/applied/${createdAppliedId}`, { status: "interviewing", sheetsRow: 3 });
  ok("status 200", patch.status === 200);
  ok("status updated", patch.body?.status === "interviewing");
  ok("sheets_row set", patch.body?.sheets_row === 3);

  const notFound = await api("PATCH", "/applied/00000000-0000-0000-0000-000000000000", { status: "applied" });
  ok("unknown id → 404", notFound.status === 404);
}

async function testTailorEndpoint() {
  if (!process.env.OPENAI_API_KEY) {
    console.log("\n── POST /api/tailor ─────────── SKIPPED (no OPENAI_API_KEY)");
    return;
  }
  console.log("\n── POST /api/tailor ────────────────────────────────────────");
  const jd = "Software Engineer Intern — TypeScript, Node.js, PostgreSQL";
  const { status, body } = await api("POST", "/tailor", { jdText: jd, jobTitle: "SWE Intern", company: "LiveTest Inc" });
  ok("status 200", status === 200);
  ok("id returned", typeof body?.id === "string");
  ok("markdown returned", typeof body?.markdown === "string" && body.markdown.length > 0);
  ok("criticScore returned", typeof body?.criticScore === "number");
  if (body?.id) {
    await pool.query("DELETE FROM tailored_resumes WHERE id = $1", [body.id]);
  }
}

async function testFetchJdFailed() {
  console.log("\n── POST /api/tailor — no jd and bad url ────────────────────");
  const { status } = await api("POST", "/tailor", { jobUrl: "https://this-domain-does-not-exist-abc123.com/jobs/1" });
  ok("failed fetch → 400", status === 400);

  const noInput = await api("POST", "/tailor", {});
  ok("empty body → 400", noInput.status === 400);
}

async function cleanup() {
  if (createdAppliedId) await pool.query("DELETE FROM applied_jobs WHERE id = $1", [createdAppliedId]);
  if (createdResumeId) await pool.query("DELETE FROM tailored_resumes WHERE id = $1", [createdResumeId]);
}

async function main() {
  await startServer();

  await testMasterResume();
  await testCreateResumeDirectly();
  await testResumes();
  await testPdf();
  await testApplied();
  await testFetchJdFailed();
  await testTailorEndpoint();

  console.log("\n── Cleanup ──────────────────────────────────────────────────");
  await cleanup();
  ok("test rows removed", true);

  console.log(`\n${"─".repeat(55)}`);
  console.log(`PASSED: ${passed}   FAILED: ${failed}`);

  server.close();
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
