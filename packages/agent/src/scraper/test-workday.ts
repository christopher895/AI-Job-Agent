import { parseWorkdaySlug, toListings } from "./adapters/workday";

let failed = false;

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`✗ ${label}\n  expected: ${e}\n  actual:   ${a}`);
    failed = true;
  } else {
    console.log(`✓ ${label}`);
  }
}

assertEqual(
  parseWorkdaySlug("snapchat.wd1/snap"),
  { host: "snapchat.wd1.myworkdayjobs.com", tenant: "snapchat", site: "snap" },
  "slug → host, tenant, site",
);
assertEqual(parseWorkdaySlug("snapchat"), null, "malformed slug → null");

const site = parseWorkdaySlug("snapchat.wd1/snap")!;
assertEqual(
  toListings("Snap", site, [
    {
      title: "Software Engineer Intern, 2027",
      externalPath: "/job/Los-Angeles-California/Software-Engineer-Intern_R1",
      locationsText: "Los Angeles, California",
    },
    { title: "Research Intern", externalPath: "/job/x/Research-Intern_R2", locationsText: "2 Locations" },
    { title: "No path" },
  ]),
  [
    {
      title: "Software Engineer Intern, 2027",
      company: "Snap",
      url: "https://snapchat.wd1.myworkdayjobs.com/snap/job/Los-Angeles-California/Software-Engineer-Intern_R1",
      location: "Los Angeles, California",
    },
    {
      title: "Research Intern",
      company: "Snap",
      url: "https://snapchat.wd1.myworkdayjobs.com/snap/job/x/Research-Intern_R2",
      location: "",
    },
  ],
  "postings → listings; 'N Locations' becomes unknown (passes the location filter); no path dropped",
);

if (failed) process.exit(1);
console.log("test-workday PASSED");
