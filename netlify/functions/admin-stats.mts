import type { Config } from "@netlify/functions";
import { PostgresAdminRepository } from "./_lib/admin-database.mts";
import { createAdminStatsHandler } from "./_lib/admin-http.mts";

export default createAdminStatsHandler(
  () => new PostgresAdminRepository(),
);

export const config: Config = {
  path: "/api/admin/stats",
  method: "GET",
};
