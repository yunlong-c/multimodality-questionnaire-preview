import type { Config } from "@netlify/functions";
import { PostgresAdminRepository } from "./_lib/admin-database.mts";
import { createAdminLogoutHandler } from "./_lib/admin-http.mts";

export default createAdminLogoutHandler(
  () => new PostgresAdminRepository(),
);

export const config: Config = {
  path: "/api/admin/logout",
  method: "POST",
};
