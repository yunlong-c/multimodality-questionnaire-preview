import type { Config } from "@netlify/functions";
import { PostgresAdminRepository } from "./_lib/admin-database.mts";
import { createAdminExportHandler } from "./_lib/admin-http.mts";

export default createAdminExportHandler(
  () => new PostgresAdminRepository(),
);

export const config: Config = {
  path: "/api/admin/export",
  method: "GET",
};
