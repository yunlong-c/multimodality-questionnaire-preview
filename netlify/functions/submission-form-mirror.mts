import type { Config } from "@netlify/functions";
import { processSubmissionMirrors } from "./_lib/submission-mirror.mts";

export default async (): Promise<void> => {
  const result = await processSubmissionMirrors({ limit: 50 });
  console.log("[mmq-submission] Forms mirror batch", result);
};

export const config: Config = {
  schedule: "*/15 * * * *",
};
