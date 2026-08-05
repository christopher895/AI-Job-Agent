import { Router } from "express";
import tailorRouter from "./routes/tailor";
import resumesRouter from "./routes/resumes";
import masterResumeRouter from "./routes/master-resume";
import appliedRouter from "./routes/applied";
import preferencesRouter from "./routes/preferences";
import placesRouter from "./routes/places";
import generalResumeRouter from "./routes/general-resume";
import playgroundRouter from "./routes/playground";
import reviewRouter from "./routes/review";

const router = Router();

router.use("/tailor", tailorRouter);
router.use("/", resumesRouter);         // defines /resumes, /resume/:id, /resume/:id/pdf, /resume/:id/email
router.use("/master-resume", masterResumeRouter);
router.use("/applied", appliedRouter);
router.use("/preferences", preferencesRouter);
router.use("/places", placesRouter);
router.use("/general-resume", generalResumeRouter);
router.use("/playground", playgroundRouter);
router.use("/review", reviewRouter);

export default router;
