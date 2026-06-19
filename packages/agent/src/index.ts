import "dotenv/config";
import express from "express";
import { initSchema } from "./db/schema";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

async function main() {
  await initSchema();

  const port = process.env.PORT ?? 3001;
  app.listen(port, () => {
    console.log(`Agent API running on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
