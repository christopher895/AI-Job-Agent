/**
 * One-time helper to mint a Gmail refresh token for ingestion.
 *
 * Prereqs: create an OAuth 2.0 "Desktop app" client in Google Cloud Console,
 * enable the Gmail API, and add your Google account as a test user on the
 * OAuth consent screen. Then:
 *
 *   GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... npx tsx scripts/mint-gmail-token.ts
 *
 * Open the printed URL, approve, paste the code back, and copy the refresh
 * token into GMAIL_OAUTH_REFRESH_TOKEN on Railway.
 */
import { google } from "googleapis";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function main() {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET first.");
    process.exit(1);
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });
  console.log("\n1. Open this URL and approve:\n\n" + url + "\n");

  const rl = readline.createInterface({ input, output });
  const code = (await rl.question("2. Paste the authorization code here: ")).trim();
  rl.close();

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error("No refresh token returned. Revoke prior access at https://myaccount.google.com/permissions and retry.");
    process.exit(1);
  }
  console.log("\n✅ GMAIL_OAUTH_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
}
main().catch((err) => { console.error(err); process.exit(1); });
