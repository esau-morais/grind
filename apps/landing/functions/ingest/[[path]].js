const API_HOST = "us.i.posthog.com";
const ASSET_HOST = "us-assets.i.posthog.com";

export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^\/ingest/, "") || "/";
  const pathWithParams = pathname + url.search;

  if (pathname.startsWith("/static/")) {
    return retrieveStatic(request, pathWithParams, context);
  }
  return forwardRequest(request, pathWithParams);
}

async function retrieveStatic(request, pathname, context) {
  const cache = caches.default;
  let response = await cache.match(request);
  if (!response) {
    response = await fetch(`https://${ASSET_HOST}${pathname}`);
    context.waitUntil(cache.put(request, response.clone()));
  }
  return response;
}

async function forwardRequest(request, pathWithSearch) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const originHeaders = new Headers(request.headers);
  originHeaders.delete("cookie");
  originHeaders.set("X-Forwarded-For", ip);
  return fetch(
    new Request(`https://${API_HOST}${pathWithSearch}`, {
      method: request.method,
      headers: originHeaders,
      body:
        request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : null,
      redirect: request.redirect,
    }),
  );
}
