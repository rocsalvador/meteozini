import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { DATA_DIR } from "../data.js";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json",
};

const router = new Hono();

/** Serve pipeline products (PNG overlays, value grids, wind fields) from data/up/static. */
router.get("/static/*", async (c) => {
  const rel = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/v1\/static\//, ""));
  const root = path.join(DATA_DIR, "static");
  const file = path.join(root, rel);
  if (!rel || rel.includes("..") || !file.startsWith(root)) return c.text("Bad request", 400);

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const type = MIME[path.extname(file)] ?? "application/octet-stream";
    const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
    return new Response(stream, {
      headers: {
        "content-type": type,
        "content-length": String(info.size),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return c.text("Not found", 404);
  }
});

export default router;
