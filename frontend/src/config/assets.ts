interface RuntimeImportMeta {
  env?: {
    BASE_URL?: string;
    VITE_ASSET_BASE_URL?: string;
  };
}

function configuredAssetBaseUrl(): string {
  const raw = (import.meta as RuntimeImportMeta).env
    ?.VITE_ASSET_BASE_URL;
  return (raw ?? "").trim().replace(/\/+$/, "");
}

export function resolveAssetUrl(assetPath: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(assetPath)) {
    return assetPath;
  }

  const normalizedPath = assetPath.replace(/^\/+/, "");
  const baseUrl = configuredAssetBaseUrl();
  if (baseUrl) {
    return `${baseUrl}/${normalizedPath}`;
  }

  const appBase = ((import.meta as RuntimeImportMeta).env?.BASE_URL ?? "/")
    .trim()
    .replace(/\/+$/, "");
  return `${appBase}/${normalizedPath}`;
}
