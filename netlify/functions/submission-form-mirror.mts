import type {
  Config,
  Context,
} from "@netlify/functions";
import { processSubmissionMirrors } from "./_lib/submission-mirror.mts";

export default async (
  request: Request,
  context: Context,
): Promise<void> => {
  const endpointUrl = request?.url
    ? new URL("/", request.url).toString()
    : context.site?.url;
  const result = await processSubmissionMirrors({
    endpointUrl,
    limit: 50,
  });
  console.log("[mmq-submission] Forms mirror batch", result);
};

export const config: Config = {
  schedule: "*/15 * * * *",
};
