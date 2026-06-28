import { Router } from "express";

const router = Router();

// Static list of major US cities — no external API needed.
const US_CITIES = [
  "Albuquerque, New Mexico",
  "Anchorage, Alaska",
  "Arlington, Texas",
  "Atlanta, Georgia",
  "Austin, Texas",
  "Baltimore, Maryland",
  "Baton Rouge, Louisiana",
  "Birmingham, Alabama",
  "Boise, Idaho",
  "Boston, Massachusetts",
  "Buffalo, New York",
  "Charlotte, North Carolina",
  "Chicago, Illinois",
  "Cincinnati, Ohio",
  "Cleveland, Ohio",
  "Colorado Springs, Colorado",
  "Columbus, Ohio",
  "Dallas, Texas",
  "Denver, Colorado",
  "Des Moines, Iowa",
  "Detroit, Michigan",
  "Durham, North Carolina",
  "El Paso, Texas",
  "Fort Worth, Texas",
  "Fresno, California",
  "Honolulu, Hawaii",
  "Houston, Texas",
  "Indianapolis, Indiana",
  "Jacksonville, Florida",
  "Kansas City, Missouri",
  "Las Vegas, Nevada",
  "Long Beach, California",
  "Los Angeles, California",
  "Louisville, Kentucky",
  "Madison, Wisconsin",
  "Memphis, Tennessee",
  "Mesa, Arizona",
  "Miami, Florida",
  "Milwaukee, Wisconsin",
  "Minneapolis, Minnesota",
  "Nashville, Tennessee",
  "New Orleans, Louisiana",
  "New York, New York",
  "Newark, New Jersey",
  "Norfolk, Virginia",
  "Oakland, California",
  "Oklahoma City, Oklahoma",
  "Omaha, Nebraska",
  "Orlando, Florida",
  "Philadelphia, Pennsylvania",
  "Phoenix, Arizona",
  "Pittsburgh, Pennsylvania",
  "Portland, Oregon",
  "Raleigh, North Carolina",
  "Richmond, Virginia",
  "Riverside, California",
  "Sacramento, California",
  "Salt Lake City, Utah",
  "San Antonio, Texas",
  "San Diego, California",
  "San Francisco, California",
  "San Jose, California",
  "Seattle, Washington",
  "St. Louis, Missouri",
  "Tampa, Florida",
  "Tucson, Arizona",
  "Tulsa, Oklahoma",
  "Virginia Beach, Virginia",
  "Washington, DC",
  "Wichita, Kansas",
].sort();

router.get("/", (req, res) => {
  const q = ((req.query.q as string) ?? "").trim().toLowerCase();
  if (q.length < 2) {
    res.json([]);
    return;
  }

  const matches = US_CITIES
    .filter((city) => city.toLowerCase().startsWith(q))
    .slice(0, 6)
    .map((name) => ({ name }));

  res.json(matches);
});

export default router;
