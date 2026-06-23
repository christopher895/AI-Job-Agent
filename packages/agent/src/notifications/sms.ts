import twilio from "twilio";
import { JobListing } from "../scraper/playwright";

const client = twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
});

export async function sendJobSMS(job: JobListing) {
  await client.messages.create({
    body: `New internship: ${job.title} at ${job.company}\n${job.url}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: process.env.YOUR_PHONE_NUMBER!,
  });
}

export async function sendJobSMSBatch(jobs: JobListing[]) {
  for (const job of jobs) {
    await sendJobSMS(job);
  }
}
