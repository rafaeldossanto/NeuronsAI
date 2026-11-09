/** A desktop server is an origin, never a URL carrying credentials, paths or a redirect. */
export function remoteOrigin(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new Error();
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      "Informe a origem HTTPS do servidor, sem caminho, usuário ou senha. HTTP é aceito apenas para um servidor local.",
    );
  }
}

export function cookiePrefix(origin: string): string {
  return new URL(origin).protocol === "https:" ? "__Host-neurons-" : "neurons-";
}
