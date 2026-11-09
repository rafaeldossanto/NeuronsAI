import { unzipSync } from "fflate";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 1000;
const ignored = (path: string) =>
  path.split(/[\\/]/).some((part) => part.startsWith(".") || part === "__MACOSX");

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}

/** Browser import strips just the selected folder, keeping all internal links and attachments. */
export async function importMemoryFiles(
  selected: File[],
): Promise<{ path: string; data: string }[]> {
  if (selected.length === 1 && selected[0]!.name.toLowerCase().endsWith(".zip")) {
    const file = selected[0]!;
    if (file.size > MAX_BYTES) throw new Error("O ZIP deve ter no máximo 20 MB.");
    let total = 0,
      count = 0;
    const seen = new Set<string>();
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        if (entry.name.endsWith("/") || ignored(entry.name)) return false;
        const normalized = entry.name.replaceAll("\\", "/").toLowerCase();
        if (seen.has(normalized)) throw new Error("O ZIP contém arquivos com o mesmo caminho.");
        seen.add(normalized);
        total += entry.originalSize;
        count++;
        if (total > MAX_BYTES || count > MAX_FILES)
          throw new Error("O cofre descompactado excede 20 MB ou 1000 arquivos.");
        return true;
      },
    });
    if (Object.values(entries).reduce((size, bytes) => size + bytes.byteLength, 0) > MAX_BYTES)
      throw new Error("O cofre descompactado excede 20 MB.");
    const paths = Object.keys(entries);
    const common = paths[0]?.split("/")[0];
    const strip = Boolean(common && paths.every((path) => path.startsWith(common + "/")));
    return paths.map((path) => ({
      path: strip ? path.slice(common!.length + 1) : path,
      data: base64(entries[path]!),
    }));
  }
  const files = selected.filter((file) => !ignored(file.webkitRelativePath || file.name));
  if (files.length > MAX_FILES || files.reduce((bytes, file) => bytes + file.size, 0) > MAX_BYTES)
    throw new Error("Importe no máximo 20 MB e 1000 arquivos por vez.");
  return Promise.all(
    files.map(async (file) => ({
      path: file.webkitRelativePath
        ? file.webkitRelativePath.split("/").slice(1).join("/")
        : file.name,
      data: base64(new Uint8Array(await file.arrayBuffer())),
    })),
  );
}
