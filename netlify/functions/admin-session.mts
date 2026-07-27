import type { Config } from "@netlify/functions";
import { createAdminSessionHandler } from "./_lib/admin-http.mts";

export default createAdminSessionHandler();

export const config: Config = {
  path: "/api/admin/session",
  method: "GET",
};
