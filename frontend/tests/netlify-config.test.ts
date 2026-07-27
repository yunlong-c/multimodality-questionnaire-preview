import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createHtmlInputs,
  shouldExcludeAdminPage,
} from "../vite.config";

const netlifyConfig = readFileSync(
  new URL("../../netlify.toml", import.meta.url),
  "utf8"
);

test("Netlify builds the static questionnaire from the repository root", () => {
  assert.match(
    netlifyConfig,
    /command = "npm --workspace multimodality-frontend run build"/
  );
  assert.match(netlifyConfig, /publish = "frontend\/dist"/);
  assert.match(netlifyConfig, /NODE_VERSION = "22"/);
  assert.match(netlifyConfig, /VITE_STATIC_PREVIEW = "true"/);
  assert.match(
    netlifyConfig,
    /VITE_DEFAULT_DATASET_CLASSIFICATION = "formal"/
  );
});

test("Netlify serves the frozen assets locally without rewriting them", () => {
  assert.match(netlifyConfig, /MMQ_EXTERNAL_ASSETS = "false"/);
  assert.doesNotMatch(netlifyConfig, /VITE_ASSET_BASE_URL/);
  assert.doesNotMatch(netlifyConfig, /raw\.githubusercontent\.com/);
  assert.doesNotMatch(netlifyConfig, /\/\.netlify\/images/);
  assert.doesNotMatch(netlifyConfig, /\[\[plugins\]\]/);
  assert.match(
    netlifyConfig,
    /\[build\.processing\]\s+skip_processing = false/
  );
  assert.match(
    netlifyConfig,
    /\[build\.processing\.images\]\s+compress = false/
  );
  assert.match(
    netlifyConfig,
    /\[build\.processing\.css\]\s+bundle = false\s+minify = false/
  );
  assert.match(
    netlifyConfig,
    /\[build\.processing\.js\]\s+bundle = false\s+minify = false/
  );
  assert.match(
    netlifyConfig,
    /for = "\/assets\/\*"\s+\[headers\.values\]\s+Cache-Control = "public, max-age=31536000, immutable"/
  );
});

test("the public Netlify build omits the unsupported admin entry", () => {
  assert.equal(shouldExcludeAdminPage({ NETLIFY: "true" }), true);
  assert.equal(
    shouldExcludeAdminPage({ MMQ_EXCLUDE_ADMIN: "true" }),
    true
  );
  assert.equal(shouldExcludeAdminPage({}), false);

  assert.deepEqual(Object.keys(createHtmlInputs(true)), ["questionnaire"]);
  assert.deepEqual(
    Object.keys(createHtmlInputs(false)).sort(),
    ["admin", "questionnaire"]
  );
  assert.match(netlifyConfig, /MMQ_EXCLUDE_ADMIN = "true"/);
});

test("cache and security headers keep HTML fresh and allow same-origin Forms", () => {
  assert.match(
    netlifyConfig,
    /for = "\/"\s+\[headers\.values\]\s+Cache-Control = "no-cache, must-revalidate"/
  );
  assert.match(
    netlifyConfig,
    /for = "\/\*\.html"\s+\[headers\.values\]\s+Cache-Control = "no-cache, must-revalidate"/
  );
  assert.match(netlifyConfig, /connect-src 'self'/);
  assert.match(netlifyConfig, /form-action 'self'/);
  assert.match(netlifyConfig, /frame-ancestors 'none'/);
  assert.match(netlifyConfig, /X-Content-Type-Options = "nosniff"/);
});
