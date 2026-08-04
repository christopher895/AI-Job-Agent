import { pool } from "./pool";
import { initSchema } from "./schema";
import { hashIp, logPlaygroundUsage, countRecentPlaygroundUsage } from "./queries";

async function main() {
  await initSchema();

  const hashA = hashIp("203.0.113.1");
  const hashB = hashIp("203.0.113.1");
  const hashDifferent = hashIp("203.0.113.2");

  const sameInputSameHash = hashA === hashB;
  const differentInputDifferentHash = hashA !== hashDifferent;

  const testHash = `test-${Date.now()}`;
  const before = await countRecentPlaygroundUsage(testHash);
  await logPlaygroundUsage(testHash);
  await logPlaygroundUsage(testHash);
  const after = await countRecentPlaygroundUsage(testHash);

  console.log(`hash consistent for same input: ${sameInputSameHash}`);
  console.log(`hash differs for different input: ${differentInputDifferentHash}`);
  console.log(`count before: ${before}, after 2 logs: ${after}`);

  const pass = sameInputSameHash && differentInputDifferentHash && before === 0 && after === 2;

  await pool.query("DELETE FROM playground_usage WHERE ip_hash = $1", [testHash]);
  await pool.end();

  console.log(pass ? "\n✓ playground-usage test PASSED" : "\n✗ playground-usage test FAILED");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
