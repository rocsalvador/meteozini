/**
 * Small process-local cache with in-flight request collapsing. Replaces the
 * per-route `revalidate` that the endpoints used to get from Next.js.
 */

type Stored = { at: number; ttl: number; value: unknown };

const store = new Map<string, Stored>();
const inflight = new Map<string, Promise<unknown>>();

export function memoize<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.value as T);

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const promise = compute()
    .then((value) => {
      store.set(key, { at: Date.now(), ttl: ttlMs, value });
      return value;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

export function fetchJson<T = unknown>(url: string, ttlMs: number): Promise<T> {
  return memoize<T>(`json:${url}`, ttlMs, async () => {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
    return (await res.json()) as T;
  });
}

export async function tryFetchJson<T = unknown>(url: string, ttlMs: number): Promise<T | null> {
  try {
    return await fetchJson<T>(url, ttlMs);
  } catch {
    return null;
  }
}

export function fetchText(url: string, ttlMs: number): Promise<string> {
  return memoize(`text:${url}`, ttlMs, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
    return res.text();
  });
}

export function fetchBuffer(
  url: string,
  ttlMs: number,
): Promise<{ body: ArrayBuffer; contentType: string }> {
  return memoize(`buf:${url}`, ttlMs, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
    return {
      body: await res.arrayBuffer(),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  });
}
