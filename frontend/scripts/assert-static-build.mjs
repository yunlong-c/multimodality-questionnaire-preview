import {
  access,
  readdir,
  readFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.VITE_STATIC_PREVIEW !== "true") {
  process.exit(0);
}

const distDirectory = fileURLToPath(
  new URL("../dist/", import.meta.url),
);
const textExtensions = new Set([".html", ".js", ".css"]);
const forbiddenPatterns = [
  {
    label: "unapproved API route",
    pattern:
      /\/api\/(?!allocate(?:\/reconcile)?(?=["'`?#]|$)|submit(?=["'`?#]|$)|admin\/(?:login|logout|session|stats|export)(?=["'`?#]|$))/,
  },
  {
    label: "GitHub Raw asset host",
    pattern: /raw\.githubusercontent\.com/i,
  },
  {
    label: "private outcome catalog",
    pattern: /outcome_catalog|\by21\b/i,
  },
];

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTextFiles(absolutePath));
    } else if (textExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

const failures = [];
for (const filename of await collectTextFiles(distDirectory)) {
  const content = await readFile(filename, "utf8");
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) {
      failures.push(
        `${path.relative(distDirectory, filename)} contains ${label}`,
      );
    }
  }
}

try {
  await access(
    path.join(distDirectory, "admin.html"),
    constants.F_OK,
  );
} catch {
  failures.push("admin.html is missing from the protected Netlify build");
}

const indexHtml = await readFile(
  path.join(distDirectory, "index.html"),
  "utf8",
);
for (const formName of [
  "mmq-submission-v1",
  "mmq-submission-v2-formal",
  "mmq-submission-v2-test",
]) {
  if (!indexHtml.includes(`name="${formName}"`)) {
    failures.push(`index.html is missing ${formName}`);
  }
}

if (failures.length > 0) {
  throw new Error(
    `Static release gate failed:\n- ${failures.join("\n- ")}`,
  );
}

console.log(
  "Static release gate passed: only allocation and authoritative submission APIs are present; no external assets or private outcomes.",
);
