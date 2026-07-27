import type { Config } from "@netlify/functions";
import { PostgresAdminRepository } from "./_lib/admin-database.mts";
import { createAdminLoginHandler } from "./_lib/admin-http.mts";

export default createAdminLoginHandler(
  () => new PostgresAdminRepository(),
);

export const config: Config = {
  path: "/api/admin/login",
  method: "POST",
};
