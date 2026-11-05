import { siteConfig } from "./config.js";
import {
  chooseDownloads,
  detectSystem,
  loadLatestRelease,
  sessionCache,
  type DownloadId,
} from "./downloads.js";

const status = document.querySelector<HTMLElement>("#download-status");
const groups = document.querySelector<HTMLElement>("#download-groups");
const system = detectSystem(navigator);
const recommended = groups?.querySelector<HTMLElement>(`[data-system="${system}"]`);
if (recommended && groups) {
  recommended.classList.add("is-recommended");
  recommended.querySelector<HTMLElement>(".system-recommendation")!.hidden = false;
  groups.prepend(recommended);
}

async function showDownloads() {
  if (!status) return;
  status.textContent = "Consultando a versão disponível…";
  const result = await loadLatestRelease({ storage: sessionCache() });
  if (result.status !== "ready") {
    status.textContent = "Primeira versão em breve";
    return;
  }
  const downloads = chooseDownloads(result.release);
  const available = Object.keys(downloads).filter((key) => key !== "checksums");
  status.textContent = available.length
    ? `Versão ${result.release.tag_name} disponível`
    : "Primeira versão em breve";
  document.querySelectorAll<HTMLAnchorElement>("[data-download]").forEach((link) => {
    const asset = downloads[link.dataset["download"] as DownloadId];
    if (!asset) return;
    link.href = asset.browser_download_url;
    link.removeAttribute("aria-disabled");
    link.removeAttribute("tabindex");
    link.querySelector<HTMLElement>(".download-state")!.textContent = "Baixar";
  });
  if (downloads.checksums) {
    const link = document.querySelector<HTMLAnchorElement>("#checksums-link")!;
    link.href = downloads.checksums.browser_download_url;
    link.hidden = false;
  }
}
void showDownloads();

const waitlist = document.querySelector<HTMLFormElement>("#waitlist-form");
if (siteConfig.waitlistUrl && waitlist) {
  const email = waitlist.querySelector<HTMLInputElement>("input")!;
  const button = waitlist.querySelector<HTMLButtonElement>("button")!;
  const notice = document.querySelector<HTMLElement>("#waitlist-notice")!;
  email.hidden = true;
  email.disabled = true;
  button.disabled = false;
  button.textContent = "Abrir lista de espera";
  notice.textContent =
    "O cadastro será feito na página de destino. Confira a política de privacidade antes de enviar seus dados.";
  waitlist.addEventListener("submit", (event) => {
    event.preventDefault();
    window.open(siteConfig.waitlistUrl!, "_blank", "noopener,noreferrer");
  });
} else {
  waitlist?.addEventListener("submit", (event) => event.preventDefault());
}
