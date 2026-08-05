import { canAdvance } from "./status-order";

let pass = true;
function check(label: string, cond: boolean) {
  if (!cond) { pass = false; console.error("✗", label); } else { console.log("✓", label); }
}

check("null -> applied", canAdvance(null, "applied"));
check("applied -> assessment", canAdvance("applied", "assessment"));
check("assessment -> interviewing", canAdvance("assessment", "interviewing"));
check("interviewing -> offer", canAdvance("interviewing", "offer"));
check("applied -> offer (skip)", canAdvance("applied", "offer"));
check("no regress interviewing -> applied", !canAdvance("interviewing", "applied"));
check("no regress interviewing -> assessment", !canAdvance("interviewing", "assessment"));
check("same status is no-op", !canAdvance("assessment", "assessment"));
check("rejected from any state", canAdvance("interviewing", "rejected"));
check("no_response from any state", canAdvance("assessment", "no_response"));
check("no leaving rejected -> assessment", !canAdvance("rejected", "assessment"));
check("no leaving rejected -> offer", !canAdvance("rejected", "offer"));
check("no leaving no_response -> interviewing", !canAdvance("no_response", "interviewing"));

console.log(pass ? "\n✓ status-order test PASSED" : "\n✗ status-order test FAILED");
process.exit(pass ? 0 : 1);
