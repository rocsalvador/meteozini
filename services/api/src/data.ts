import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this file (works for both src/ and dist/). */
export const REPO_ROOT = path.resolve(here, "../../..");

/** Root of the pipeline products. Override with MZ_DATA_DIR. */
export const DATA_DIR = path.resolve(
  process.env.MZ_DATA_DIR ?? path.join(REPO_ROOT, "data", "up"),
);
