import { Router } from "express";

const router = Router();

type NominatimResult = {
  display_name: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
};

function formatPlace(r: NominatimResult): { name: string; displayName: string } {
  const a = r.address;
  const city = a.city ?? a.town ?? a.village ?? "";
  const secondary =
    a.country_code === "us" ? a.state ?? a.country ?? "" : a.country ?? "";
  const displayName = [city, secondary].filter(Boolean).join(", ");
  return { name: city.toLowerCase(), displayName };
}

router.get("/", async (req, res) => {
  const q = (req.query.q as string ?? "").trim();
  if (q.length < 2) {
    res.json([]);
    return;
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "6");
    url.searchParams.set("featuretype", "city");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "AI-Job-Agent/1.0 (zhanggopher895@gmail.com)",
        "Accept-Language": "en",
      },
    });

    if (!response.ok) {
      res.status(502).json({ error: "Geocoding service unavailable" });
      return;
    }

    const results: NominatimResult[] = await response.json();
    const places = results
      .map(formatPlace)
      .filter((p) => p.name.length > 0)
      .filter((p, i, arr) => arr.findIndex((x) => x.name === p.name) === i);

    res.json(places);
  } catch (err) {
    console.error("[places] Nominatim error:", err);
    res.status(502).json({ error: "Geocoding service unavailable" });
  }
});

export default router;
