import { google } from "googleapis";

/**
 * Column layout in the Google Sheet (A–G):
 * A: Company  B: Role  C: Location  D: Link
 * E: Date     F: Status              G: Resume
 *
 * Set up row 1 as a header manually before first use.
 * Requires GOOGLE_SHEETS_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON env vars.
 * The service account must have Editor access to the spreadsheet.
 */

const COLUMNS = "A:G";

// Cached on first successful API call — avoids an extra round-trip on every append
let resolvedSheetName: string | null = null;

async function getSheetName(sheets: ReturnType<typeof google.sheets>, sheetId: string): Promise<string> {
  if (resolvedSheetName) return resolvedSheetName;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  resolvedSheetName = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  return resolvedSheetName;
}

export type SheetRowData = {
  appliedAt: Date;
  company: string;
  jobTitle: string;
  location?: string | null;
  jobUrl?: string | null;
  status: string;
  resumeLink?: string | null;
};

function getClient() {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!credJson || !sheetId) return null;

  let credentials: object;
  try {
    credentials = JSON.parse(credJson);
  } catch {
    console.error("[sheets] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheets: google.sheets({ version: "v4", auth }), sheetId };
}

function toRow(data: SheetRowData): string[] {
  return [
    data.company,
    data.jobTitle,
    data.location ?? "",
    data.jobUrl ?? "",
    data.appliedAt.toLocaleDateString("en-US"),
    data.status,
    data.resumeLink ?? "",
  ];
}

/** Appends a new application row. Returns the sheet row number (1-indexed) for future updates. */
export async function appendRow(data: SheetRowData): Promise<number | null> {
  const client = getClient();
  if (!client) {
    console.warn("[sheets] env vars not configured — skipping sync");
    return null;
  }

  const sheetName = await getSheetName(client.sheets, client.sheetId);
  const res = await client.sheets.spreadsheets.values.append({
    spreadsheetId: client.sheetId,
    range: `${sheetName}!${COLUMNS}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [toRow(data)] },
  });

  // updatedRange looks like "Sheet1!A5:G5" — extract the trailing row number
  const rowNum = parseInt(res.data.updates?.updatedRange?.match(/(\d+)$/)?.[1] ?? "", 10);
  return isNaN(rowNum) ? null : rowNum;
}

/** Updates only the status cell (column F) for an existing row. */
export async function syncStatusToSheet(sheetsRow: number, status: string): Promise<void> {
  const client = getClient();
  if (!client) {
    console.warn("[sheets] env vars not configured — skipping sync");
    return;
  }

  const sheetName = await getSheetName(client.sheets, client.sheetId);
  await client.sheets.spreadsheets.values.update({
    spreadsheetId: client.sheetId,
    range: `${sheetName}!F${sheetsRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[status]] },
  });
}
