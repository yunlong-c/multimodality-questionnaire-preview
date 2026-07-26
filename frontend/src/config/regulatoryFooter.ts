interface RegulatoryImportMeta {
  env?: {
    VITE_ICP_NUMBER?: string;
    VITE_PSB_NUMBER?: string;
    VITE_PSB_CODE?: string;
  };
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderRegulatoryFooter(): void {
  const footer = document.querySelector<HTMLElement>(
    "#regulatory-footer",
  );
  if (!footer) {
    return;
  }

  const env = (import.meta as RegulatoryImportMeta).env;
  const icpNumber = clean(env?.VITE_ICP_NUMBER);
  const psbNumber = clean(env?.VITE_PSB_NUMBER);
  const psbCode = clean(env?.VITE_PSB_CODE);
  const links: string[] = [];

  if (icpNumber) {
    links.push(
      `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">${escapeHtml(icpNumber)}</a>`,
    );
  }
  if (psbNumber && /^\d{12,20}$/.test(psbCode)) {
    links.push(
      `<a href="https://beian.mps.gov.cn/#/query/webSearch?code=${encodeURIComponent(psbCode)}" target="_blank" rel="noreferrer">${escapeHtml(psbNumber)}</a>`,
    );
  }

  if (links.length === 0) {
    footer.hidden = true;
    footer.innerHTML = "";
    return;
  }

  footer.hidden = false;
  footer.innerHTML = links.join(
    '<span aria-hidden="true"> · </span>',
  );
}
