import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFromHtml } from "./fetch-jd";

const fixturePath = join(__dirname, "test-fixtures", "bofa-job.html");
const html = readFileSync(fixturePath, "utf-8");
const url =
  "https://bankcampuscareers.tal.net/vx/lang-en-GB/mobile-0/brand-4/user-5282441/candidate/so/pm/1/pl/1/opp/14418-Global-Technology-Summer-Analyst-2027-Software-Engineer-and-Mainframe-Analyst/en-GB";

const result = extractFromHtml(html, url);

console.log("title:", result.title);
console.log("company:", result.company);
console.log("text length:", result.text.length);

const noCookieBanner = !result.text.includes("Strictly Necessary cookies");
const noGtmNoise = !result.text.toLowerCase().includes("googletagmanager");
const hasRealContent = result.text.includes("mainframe environment is the third largest");
const titleCorrect =
  result.title === "Global Technology Summer Analyst 2027 - Software Engineer and Mainframe Analyst";
const companyCorrect = result.company === "Bank of America";

if (!noCookieBanner) console.log("   ✗ cookie banner text leaked into extracted JD");
if (!noGtmNoise) console.log("   ✗ GTM/analytics noise leaked into extracted JD");
if (!hasRealContent) console.log("   ✗ missing expected job description content");
if (!titleCorrect) console.log(`   ✗ title mismatch: got ${JSON.stringify(result.title)}`);
if (!companyCorrect) console.log(`   ✗ company mismatch: got ${JSON.stringify(result.company)}`);

const pass = noCookieBanner && noGtmNoise && hasRealContent && titleCorrect && companyCorrect;
console.log(pass ? "\n✓ fetch-jd extraction test PASSED" : "\n✗ fetch-jd extraction test FAILED");
process.exit(pass ? 0 : 1);
