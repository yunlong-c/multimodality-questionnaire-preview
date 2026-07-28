import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

import { makeSinglePlayGif, sha256 } from "./scripts/singlePlayGif";
import { videoPlaybackManifestByPresentationUid } from "./src/data/videoPlaybackManifest.generated";

const pagesBase =
  process.env.MMQ_GITHUB_PAGES_BASE?.trim() || "/";
const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const staticPreviewBuild =
  process.env.VITE_STATIC_PREVIEW === "true";
const authoritativeSubmissionBuild =
  process.env.VITE_AUTHORITATIVE_SUBMISSION === "true";
const playbackMetadataByFilename = new Map(
  Object.values(videoPlaybackManifestByPresentationUid).map(
    (metadata) => [
      `${metadata.sequence_uid}.gif`,
      metadata,
    ] as const
  )
);

function singlePlayVideoDevelopmentPlugin(): Plugin {
  const routeMarker = "/assets/video-single-play-v1/";

  return {
    name: "mmq-single-play-video-development-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          const pathname = new URL(
            request.url ?? "/",
            "http://localhost"
          ).pathname;
          const markerIndex = pathname.indexOf(routeMarker);
          if (markerIndex < 0) {
            next();
            return;
          }

          const filename = decodeURIComponent(
            pathname.slice(markerIndex + routeMarker.length)
          );
          if (!/^MMQ-[A-Z0-9-]+\.gif$/.test(filename)) {
            next();
            return;
          }

          const metadata = playbackMetadataByFilename.get(filename);
          if (!metadata) {
            next();
            return;
          }
          const sourcePath = resolve(
            frontendRoot,
            "public",
            ...metadata.source_asset_path.split("/")
          );
          const sourceBytes = await readFile(sourcePath);
          const transformed = makeSinglePlayGif(sourceBytes);
          if (
            sha256(transformed.bytes) !==
            metadata.playback_asset_sha256
          ) {
            throw new Error(
              `Single-play development GIF hash mismatch: ${filename}`
            );
          }

          response.statusCode = 200;
          response.setHeader("Content-Type", "image/gif");
          response.setHeader(
            "Content-Length",
            String(transformed.bytes.length)
          );
          response.setHeader("Cache-Control", "no-cache");
          if (request.method === "HEAD") {
            response.end();
            return;
          }
          response.end(transformed.bytes);
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            next();
            return;
          }
          next(error);
        }
      });
    },
  };
}

export function shouldExcludeAdminPage(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.MMQ_EXCLUDE_ADMIN === "true";
}

export function createHtmlInputs(
  excludeAdminPage: boolean
): Record<string, string> {
  const inputs: Record<string, string> = {
    questionnaire: resolve(frontendRoot, "index.html"),
  };

  if (!excludeAdminPage) {
    inputs.admin = resolve(frontendRoot, "admin.html");
  }

  return inputs;
}

export default defineConfig(({ command }) => {
  const externalAssets =
    process.env.MMQ_EXTERNAL_ASSETS === "true";

  return {
    base: pagesBase,
    plugins:
      command === "serve" && !externalAssets
        ? [singlePlayVideoDevelopmentPlugin()]
        : [],
    define: {
      __MMQ_STATIC_PREVIEW__: JSON.stringify(
        staticPreviewBuild
      ),
      __MMQ_AUTHORITATIVE_SUBMISSION__: JSON.stringify(
        authoritativeSubmissionBuild
      ),
    },
    resolve: {
      alias: staticPreviewBuild
        ? [
            {
              find: /^\.\/serverClient$/,
              replacement: resolve(
                frontendRoot,
                "src/api/staticServerClient.ts"
              ),
            },
          ]
        : [],
    },
    // Build output is assembled after Vite so the 272 original looping GIFs
    // are never published beside their single-play derivatives.
    publicDir:
      command === "build" || externalAssets
        ? false
        : "public",
    build: {
      rollupOptions: {
        input: createHtmlInputs(shouldExcludeAdminPage()),
        output: {
          manualChunks(id) {
            if (
              id.includes("/node_modules/jspsych/") ||
              id.includes("/node_modules/@jspsych/")
            ) {
              return "jspsych-vendor";
            }
            if (id.includes("sequenceCatalog.generated")) {
              return "stimulus-catalog";
            }
          },
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": {
          target: process.env.MMQ_API_TARGET ?? "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
  };
});
