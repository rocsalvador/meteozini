import { type MapFrame, type ValueGrid, valuesUrl } from "@meteozini/core";

/** Decode a pipeline value grid (RGBA PNG) into a Float32Array. Browser-only. */
export async function loadValueGrid(frame: MapFrame): Promise<ValueGrid | null> {
  const url = valuesUrl(frame);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const meta = await res.json();
    const [height, width] = meta.shape ?? [];
    if (!width || !height || !(meta.step > 0)) return null;
    const imgUrl = url.replace(/[^/]+$/, meta.file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.crossOrigin = "anonymous";
      el.decoding = "async";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("grid image"));
      el.src = imgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    const values = new Float32Array(width * height);
    for (let i = 0, p = 0; i < values.length; i += 1, p += 4) {
      values[i] = data[p + 3] < 128 ? NaN : meta.min + (256 * data[p] + data[p + 1]) * meta.step;
    }
    return { width, height, bounds: meta.bounds, min: meta.min, step: meta.step, unit: meta.unit ?? "", values };
  } catch {
    return null;
  }
}
