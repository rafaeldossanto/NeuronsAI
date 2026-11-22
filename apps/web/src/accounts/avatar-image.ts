const TYPES = ["image/png", "image/jpeg", "image/webp"];

/** A small, square PNG keeps storage bounded and strips the original image's metadata. */
export async function readAvatarImage(file: File): Promise<string> {
  if (!TYPES.includes(file.type)) throw new Error("Escolha uma imagem PNG, JPG ou WebP.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Escolha uma imagem de até 5 MB.");
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Não foi possível ler a imagem."));
    };
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("Imagem inválida. Escolha outro arquivo."));
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const context = canvas.getContext("2d");
        if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error();
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        context.drawImage(
          image,
          (image.naturalWidth - size) / 2,
          (image.naturalHeight - size) / 2,
          size,
          size,
          0,
          0,
          256,
          256,
        );
        const result = canvas.toDataURL("image/png");
        if (!result.startsWith("data:image/png;base64,")) throw new Error();
        resolve(result);
      } catch {
        reject(new Error("Não foi possível preparar a imagem. Escolha outro arquivo."));
      }
    };
    image.src = source;
  });
}
