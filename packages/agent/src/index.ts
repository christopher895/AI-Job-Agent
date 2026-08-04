import "./polyfills";
import "./db/pool"; // load dotenv first
import express from "express";
import { initSchema } from "./db/schema";
import { startScheduler } from "./cron/scheduler";
import apiRouter from "./api/index";
import { requireInternalSecret } from "./api/internal-secret";

const app = express();

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/api", requireInternalSecret, apiRouter);

async function main() {
  await initSchema();
  startScheduler();

  const port = process.env.PORT ?? 3001;
  app.listen(port, () => {
    console.log(`Agent running on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
