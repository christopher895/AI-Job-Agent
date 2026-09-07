/**
 * Re-renders the stored PDF of every finished tailored resume from its current
 * Markdown. Use after a change to Resume_Template/czresume.cls or render-pdf.ts
 * so resumes generated before the change pick it up — a stored PDF is otherwise
 * only regenerated when the Markdown is edited.
 *
 * Needs DATABASE_URL and a local tectonic. Against production:
 *
 *   railway run --service <agent service> -- npx tsx scripts/rerender-pdfs.ts
 *
 * Or locally: DATABASE_URL=... npx tsx scripts/rerender-pdfs.ts
 *
 * Pass --dry-run to list what would be re-rendered without writing anything.
 */
import { pool } from "../src/db/pool";
import { storePdf, setPdfError } from "../src/db/queries";
import { renderPdf } from "../src/ai/render-pdf";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const { rows } = await pool.query<{ id: string; company: string | null; job_title: string | null; markdown: string }>(
    `SELECT id, company, job_title, markdown
       FROM tailored_resumes
      WHERE status = 'ready' AND markdown IS NOT NULL
      ORDER BY created_at`
  );
  console.log(`${rows.length} ready resume(s)${dryRun ? " (dry run)" : ""}`);

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const label = `${row.id.slice(0, 8)} ${row.company ?? "?"} — ${row.job_title ?? "?"}`;
    if (dryRun) {
      console.log(`  would re-render ${label}`);
      continue;
    }
    try {
      const pdf = await renderPdf(row.markdown);
      await storePdf(row.id, pdf);
      ok++;
      console.log(`  ✓ ${label}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await setPdfError(row.id, message).catch(() => {});
      console.error(`  ✗ ${label}: ${message.split("\n")[0]}`);
    }
  }
  if (!dryRun) console.log(`\nre-rendered ${ok}, failed ${failed}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
