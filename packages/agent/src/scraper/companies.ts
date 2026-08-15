export type Platform = "greenhouse" | "ashby" | "lever" | "workday" | "google" | "amazon" | "meta" | "apple" | "goldman";

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
  { name: "SpaceX",          platform: "greenhouse", slug: "spacex" },
  { name: "xAI",             platform: "greenhouse", slug: "xai" },
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
  { name: "Dropbox",         platform: "greenhouse", slug: "dropbox" },
  { name: "DoorDash",        platform: "greenhouse", slug: "doordashusa" },
  { name: "Scale AI",        platform: "greenhouse", slug: "scaleai" },
  { name: "Descript",        platform: "greenhouse", slug: "descript" },
  { name: "Together AI",     platform: "greenhouse", slug: "togetherai" },
  { name: "Hex",             platform: "greenhouse", slug: "HexTechnologies" },
  { name: "Gusto",           platform: "greenhouse", slug: "gusto" },
  { name: "Pave",            platform: "greenhouse", slug: "paveakatroveinformationtechnologies" },
  { name: "Peloton",         platform: "greenhouse", slug: "peloton" },
  { name: "Zwift",           platform: "greenhouse", slug: "zwift" },
  { name: "SeatGeek",        platform: "greenhouse", slug: "seatgeek" },
  { name: "Datadog",         platform: "greenhouse", slug: "datadog" },
  { name: "MongoDB",         platform: "greenhouse", slug: "mongodb" },
  { name: "CoreWeave",       platform: "greenhouse", slug: "coreweave" },
  { name: "Braze",           platform: "greenhouse", slug: "braze" },
  { name: "Klaviyo",         platform: "greenhouse", slug: "klaviyo" },
  { name: "Fivetran",        platform: "greenhouse", slug: "fivetran" },
  { name: "Glean",           platform: "greenhouse", slug: "gleanwork" },
  { name: "Grafana Labs",    platform: "greenhouse", slug: "grafanalabs" },
  { name: "Elastic",         platform: "greenhouse", slug: "elastic" },
  { name: "LaunchDarkly",    platform: "greenhouse", slug: "launchdarkly" },
  { name: "Instacart",       platform: "greenhouse", slug: "instacart" },
  { name: "Block",           platform: "greenhouse", slug: "block" },
  { name: "Asana",           platform: "greenhouse", slug: "asana" },
  { name: "Mercury",         platform: "greenhouse", slug: "mercury" },

  // ── Greenhouse — quant trading & finance ────────────────────────────────────
  { name: "Jane Street",     platform: "greenhouse", slug: "janestreet" },
  { name: "Jump Trading",    platform: "greenhouse", slug: "jumptrading" },
  { name: "Optiver",         platform: "greenhouse", slug: "optiverus" },
  { name: "IMC Trading",     platform: "greenhouse", slug: "imc" },
  { name: "DRW",             platform: "greenhouse", slug: "drweng" },
  { name: "Akuna Capital",   platform: "greenhouse", slug: "akunacapital" },
  { name: "Old Mission",     platform: "greenhouse", slug: "oldmissioncapital" },
  { name: "Five Rings",      platform: "greenhouse", slug: "fiveringsllc" },
  { name: "Point72",         platform: "greenhouse", slug: "point72" },
  { name: "Squarepoint",     platform: "greenhouse", slug: "squarepointcapital" },
  { name: "Tower Research",  platform: "greenhouse", slug: "towerresearchcapital" },
  { name: "Virtu Financial", platform: "greenhouse", slug: "virtu" },
  { name: "Flow Traders",    platform: "greenhouse", slug: "flowtraders" },
  { name: "AQR",             platform: "greenhouse", slug: "aqr" },

  // ── Greenhouse — fintech ────────────────────────────────────────────────────
  { name: "SoFi",            platform: "greenhouse", slug: "sofi" },
  { name: "Betterment",      platform: "greenhouse", slug: "betterment" },
  { name: "Marqeta",         platform: "greenhouse", slug: "marqeta" },
  { name: "Carta",           platform: "greenhouse", slug: "carta" },
  { name: "BILL",            platform: "greenhouse", slug: "billcom" },
  { name: "Ripple",          platform: "greenhouse", slug: "ripple" },
  { name: "Fireblocks",      platform: "greenhouse", slug: "fireblocks" },
  { name: "Alloy",           platform: "greenhouse", slug: "alloy" },
  { name: "Lithic",          platform: "greenhouse", slug: "lithic" },

  // ── Ashby ────────────────────────────────────────────────────────────────────
  { name: "OpenAI",          platform: "ashby", slug: "openai" },
  { name: "Notion",          platform: "ashby", slug: "notion" },
  { name: "Ramp",            platform: "ashby", slug: "ramp" },
  { name: "Linear",          platform: "ashby", slug: "linear" },
  { name: "Cursor",          platform: "ashby", slug: "cursor" },
  { name: "Perplexity",      platform: "ashby", slug: "perplexity" },
  { name: "Vanta",           platform: "ashby", slug: "vanta" },
  { name: "Deel",            platform: "ashby", slug: "deel" },
  { name: "Replit",          platform: "ashby", slug: "replit" },
  { name: "Vercel",          platform: "ashby", slug: "vercel" },
  { name: "Supabase",        platform: "ashby", slug: "supabase" },
  { name: "ElevenLabs",      platform: "ashby", slug: "elevenlabs" },
  { name: "Character.AI",    platform: "ashby", slug: "character" },
  { name: "Amplitude",       platform: "ashby", slug: "amplitude" },
  { name: "Plaid",           platform: "ashby", slug: "plaid" },
  { name: "Benchling",       platform: "ashby", slug: "benchling" },
  { name: "Superhuman",      platform: "ashby", slug: "superhuman" },
  { name: "Fin.ai",          platform: "ashby", slug: "fin" },                  // formerly Intercom
  { name: "Whoop",           platform: "ashby", slug: "whoop" },
  { name: "Eight Sleep",     platform: "ashby", slug: "eightsleep" },
  { name: "Strava",          platform: "ashby", slug: "strava" },
  { name: "Teamworks",       platform: "ashby", slug: "teamworks" },
  { name: "Cerebras",        platform: "ashby", slug: "cerebras" },
  { name: "Snowflake",       platform: "ashby", slug: "snowflake" },
  { name: "Modal",           platform: "ashby", slug: "modal" },
  { name: "Pinecone",        platform: "ashby", slug: "pinecone" },
  { name: "Temporal",        platform: "ashby", slug: "temporal" },
  { name: "Sentry",          platform: "ashby", slug: "sentry" },
  { name: "Harvey",          platform: "ashby", slug: "harvey" },
  { name: "Sierra",          platform: "ashby", slug: "sierra" },
  { name: "Decagon",         platform: "ashby", slug: "decagon" },
  { name: "Cognition",       platform: "ashby", slug: "cognition" },            // makers of Devin

  // ── Ashby — fintech ──────────────────────────────────────────────────────────
  { name: "Modern Treasury", platform: "ashby", slug: "moderntreasury" },
  { name: "Column",          platform: "ashby", slug: "column" },
  { name: "Sardine",         platform: "ashby", slug: "sardine" },
  { name: "Middesk",         platform: "ashby", slug: "middesk" },
  { name: "SentiLink",       platform: "ashby", slug: "sentilink" },
  { name: "Nubank",          platform: "ashby", slug: "nubank" },

  // ── Lever ────────────────────────────────────────────────────────────────────
  // Atlassian dropped 2026-08-15: it self-hosts its board now and 404s on
  // Lever, Greenhouse and Ashby alike, so the entry only logged a warning.
  { name: "Mistral",         platform: "lever", slug: "mistral" },
  { name: "Persona",         platform: "lever", slug: "withpersona" },
  { name: "Belvedere Trading", platform: "lever", slug: "belvederetrading" },
  { name: "Wealthfront",     platform: "lever", slug: "wealthfront" },
  { name: "Anchorage Digital", platform: "lever", slug: "anchorage" },

  // ── Custom APIs ───────────────────────────────────────────────────────────────
  { name: "Amazon",          platform: "amazon", slug: "amazon" },
  // Oracle Fusion recruiting pod behind higher.gs.com — see adapters/goldman.ts
  { name: "Goldman Sachs",   platform: "goldman", slug: "goldmansachs" },

  // ── Workday — adapter not yet built (Playwright required) ────────────────────
  // { name: "Netflix",      platform: "workday", slug: "Netflix" },
  // { name: "Snap",         platform: "workday", slug: "snapchat" },
  // { name: "Zendesk",      platform: "workday", slug: "zendesk" },
  // { name: "Microsoft",    platform: "workday", slug: "microsoftcorporation" },

  // ── Custom (Playwright) — adapters not yet built ──────────────────────────────
  // { name: "Google",       platform: "google", slug: "google" },
  // { name: "Meta",         platform: "meta",   slug: "meta" },
  // { name: "Apple",        platform: "apple",  slug: "apple" },
  // { name: "Rippling",     platform: "amazon", slug: "rippling" },  // custom ATS
];
