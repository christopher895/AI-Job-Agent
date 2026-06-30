import { Router } from "express";
import tailorRouter from "./routes/tailor";
import resumesRouter from "./routes/resumes";
import masterResumeRouter from "./routes/master-resume";
import appliedRouter from "./routes/applied";
import preferencesRouter from "./routes/preferences";
import placesRouter from "./routes/places";

const router = Router();

router.use("/tailor", tailorRouter);
router.use("/", resumesRouter);         // defines /resumes, /resume/:id, /resume/:id/pdf, /resume/:id/email
router.use("/master-resume", masterResumeRouter);
router.use("/applied", appliedRouter);
router.use("/preferences", preferencesRouter);
router.use("/places", placesRouter);

export default router;
