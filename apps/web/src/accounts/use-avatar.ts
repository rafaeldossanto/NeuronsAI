import { useEffect, useState } from "react";
import { readAvatarImage } from "./avatar-image";

export function useAvatar(userId: string | undefined) {
  const key = `neurons:avatar:${userId ?? "local"}`;
  const desktop = window.neuronsDesktop;
  const native = !userId && desktop?.localResources !== false ? desktop?.avatar : undefined;
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const image = native ? await native.read() : localStorage.getItem(key);
        if (active)
          setImages((previous) => ({
            ...previous,
            [key]: image?.startsWith("data:image/png;base64,") ? image : null,
          }));
      } catch {
        if (active) {
          setImages((previous) => ({ ...previous, [key]: null }));
          setError({ key, message: "Não foi possível carregar a imagem do perfil." });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [key, native]);

  async function change(file: File) {
    setSaving(key);
    setError(null);
    try {
      const image = await readAvatarImage(file);
      try {
        if (native) await native.write(image);
        else localStorage.setItem(key, image);
      } catch {
        throw new Error("Não foi possível salvar a imagem do perfil. Tente novamente.");
      }
      setImages((previous) => ({ ...previous, [key]: image }));
    } catch (failure) {
      setError({
        key,
        message: failure instanceof Error ? failure.message : "Não foi possível alterar a imagem.",
      });
    } finally {
      setSaving((previous) => (previous === key ? null : previous));
    }
  }

  return {
    image: images[key] ?? null,
    busy: saving === key || !(key in images),
    error: error?.key === key ? error.message : "",
    change,
  };
}
