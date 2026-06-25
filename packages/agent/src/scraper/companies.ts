export type Platform = "greenhouse" | "ashby" | "lever" | "workday" | "google" | "amazon" | "meta" | "apple";

export interface Company {
  name: string;
  platform: Platform;
  slug: string;
}

export const COMPANIES: Company[] = [
  // ── Greenhouse ──────────────────────────────────────────────────────────────
  { name: "Anthropic",       platform: "greenhouse", slug: "anthropic" },
  { name: "Stripe",          platform: "greenhouse", slug: "stripe" },
  { name: "Airbnb",          platform: "greenhouse", slug: "airbnb" },
  { name: "Databricks",      platform: "greenhouse", slug: "databricks" },
  { name: "Coinbase",        platform: "greenhouse", slug: "coinbase" },
  { name: "Cloudflare",      platform: "greenhouse", slug: "cloudflare" },
  { name: "Lyft",            platform: "greenhouse", slug: "lyft" },
  { name: "Affirm",          platform: "greenhouse", slug: "affirm" },
  { name: "Anduril",         platform: "greenhouse", slug: "andurilindustries" },
  { name: "xAI",             platform: "greenhouse", slug: "xai" },
  // Rippling uses a custom ATS (not Greenhouse/Ashby/Lever) — needs a custom adapter
  // { name: "Rippling",     platform: "greenhouse", slug: "rippling" },
  { name: "Discord",         platform: "greenhouse", slug: "discord" },
  { name: "Duolingo",        platform: "greenhouse", slug: "duolingo" },
  { name: "Reddit",          platform: "greenhouse", slug: "reddit" },
  { name: "Brex",            platform: "greenhouse", slug: "brex" },
  { name: "Chime",           platform: "greenhouse", slug: "chime" },
  { name: "Airtable",        platform: "greenhouse", slug: "airtable" },
  { name: "Figma",           platform: "greenhouse", slug: "figma" },
  { name: "Robinhood",       platform: "greenhouse", slug: "robinhood" },
  { name: "Gemini",          platform: "greenhouse", slug: "gemini" },
  { name: "Watershed",       platform: "greenhouse", slug: "watershed" },
  { name: "Roblox",          platform: "greenhouse", slug: "roblox" },
  { name: "Twilio",          platform: "greenhouse", slug: "twilio" },
  { name: "Dropbox",         platform: "greenhouse", slug: "dropbox" },         // confirmed

  // ── Ashby ────────────────────────────────────────────────────────────────────
  { name: "OpenAI",          platform: "ashby", slug: "openai" },
  { name: "Notion",          platform: "ashby", slug: "notion" },
  { name: "Ramp",            platform: "ashby", slug: "ramp" },
  { name: "Linear",          platform: "ashby", slug: "linear" },
  { name: "Cursor",          platform: "ashby", slug: "cursor" },               // confirmed
  { name: "Perplexity",      platform: "ashby", slug: "perplexity" },
  { name: "Vanta",           platform: "ashby", slug: "vanta" },
  { name: "Deel",            platform: "ashby", slug: "deel" },
  { name: "Replit",          platform: "ashby", slug: "replit" },
  { name: "Vercel",          platform: "ashby", slug: "vercel" },
  { name: "Supabase",        platform: "ashby", slug: "supabase" },
  { name: "ElevenLabs",      platform: "ashby", slug: "elevenlabs" },
  { name: "Character.AI",    platform: "ashby", slug: "character" },            // confirmed
  { name: "Amplitude",       platform: "ashby", slug: "amplitude" },            // confirmed (moved from Lever)

  // ── Lever ────────────────────────────────────────────────────────────────────
  { name: "Atlassian",       platform: "lever", slug: "atlassian" },

  // ── Unverified slugs — comment back in after checking the company's careers page ──
  // Greenhouse (slug lookup: boards-api.greenhouse.io/v1/boards/{slug}/jobs)
  // { name: "Superhuman",   platform: "greenhouse", slug: "???" },
  // { name: "Plaid",        platform: "greenhouse", slug: "???" },
  // { name: "Retool",       platform: "greenhouse", slug: "???" },
  // { name: "Pave",         platform: "greenhouse", slug: "???" },
  // { name: "Benchling",    platform: "greenhouse", slug: "???" },
  // { name: "Coda",         platform: "greenhouse", slug: "???" },
  // { name: "Persona",      platform: "greenhouse", slug: "???" },

  // Ashby (slug lookup: api.ashbyhq.com/posting-api/job-board/{slug})
  // { name: "Descript",     platform: "ashby", slug: "???" },
  // { name: "Together AI",  platform: "ashby", slug: "???" },
  // { name: "Mistral",      platform: "ashby", slug: "???" },
  // { name: "Hex",          platform: "ashby", slug: "???" },
  // { name: "Gusto",        platform: "ashby", slug: "???" },
  // { name: "Intercom",     platform: "ashby", slug: "???" },
  // { name: "Loom",         platform: "ashby", slug: "???" },

  // Lever (slug lookup: api.lever.co/v0/postings/{slug}?mode=json)
  // { name: "Zendesk",      platform: "lever", slug: "???" },
  // { name: "DoorDash",     platform: "lever", slug: "???" },
  // { name: "Dropbox",      platform: "lever", slug: "???" },  -> moved to greenhouse
  // { name: "Snap",         platform: "lever", slug: "???" },
  // { name: "Netflix",      platform: "lever", slug: "???" },
  // { name: "Scale AI",     platform: "lever", slug: "???" },

  // ── Custom (Playwright) — adapters not yet built ─────────────────────────────
  // { name: "Google",       platform: "google", slug: "google" },
  // { name: "Amazon",       platform: "amazon", slug: "amazon" },
  // { name: "Meta",         platform: "meta",   slug: "meta" },
  // { name: "Apple",        platform: "apple",  slug: "apple" },
];
