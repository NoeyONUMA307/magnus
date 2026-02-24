const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 50 * 1024;

function makeController(): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return controller;
}

export async function safeFetch(
  url: string,
  init: RequestInit = {},
  extraHeaders?: Record<string, string>
): Promise<Response | null> {
  try {
    const controller = makeController();
    const merged = extraHeaders
      ? { ...extraHeaders, ...(init.headers as Record<string, string> ?? {}) }
      : init.headers;
    return await fetch(url, { ...init, headers: merged, signal: controller.signal });
  } catch {
    return null;
  }
}
