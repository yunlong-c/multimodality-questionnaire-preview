import type {
  Config,
  Context,
} from "@netlify/functions";
import { PostgresSubmissionRepository } from "./_lib/submission-database.mts";
import { createSubmitHandler } from "./_lib/submission-http.mts";
import { processSubmissionMirrorReceipt } from "./_lib/submission-mirror.mts";

const handler = createSubmitHandler(
  () => new PostgresSubmissionRepository(),
  processSubmissionMirrorReceipt,
);

export default (request: Request, context: Context) =>
  handler(request, context);

export const config: Config = {
  path: "/api/submit",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowSize: 60,
    windowLimit: 120,
  },
};
