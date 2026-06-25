import "../db/pool"; // ensure dotenv is loaded
import { runAllCompanyScrapes } from "./index";

runAllCompanyScrapes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
