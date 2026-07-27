import type { Config } from "@netlify/functions";
import { PostgresRandomizationRepository } from "./_lib/randomization-database.mts";
import { createReconcileHandler } from "./_lib/randomization-http.mts";

export default createReconcileHandler(
  () => new PostgresRandomizationRepository(),
);

export const config: Config = {
  path: "/api/allocate/reconcile",
  method: "POST",
};
