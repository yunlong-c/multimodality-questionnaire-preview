import type { Config } from "@netlify/functions";
import { PostgresRandomizationRepository } from "./_lib/randomization-database.mts";
import { createAllocateHandler } from "./_lib/randomization-http.mts";

export default createAllocateHandler(
  () => new PostgresRandomizationRepository(),
);

export const config: Config = {
  path: "/api/allocate",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["domain", "ip"],
    windowSize: 60,
    windowLimit: 300,
  },
};
