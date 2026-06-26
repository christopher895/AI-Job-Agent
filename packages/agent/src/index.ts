import "./db/pool"; // load dotenv first
import express from "express";
import { initSchema } from "./db/schema";
import { startScheduler } from "./cron/scheduler";
import apiRouter from "./api/index";

const app = express();

// CORS — allow the Next.js web app to call the API
app.use((req, res, next) => {
  const origin = process.env.WEB_URL ?? "http://localhost:3000";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/api", apiRouter);

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
