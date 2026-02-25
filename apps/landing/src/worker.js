const DOCS_HOSTNAME = "emots.mintlify.dev";
const SITE_HOSTNAME = "docs.grindxp.app";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/.well-known/")) {
      return fetch(request);
    }

    if (url.pathname.startsWith("/docs")) {
      const proxyUrl = new URL(request.url);
      proxyUrl.hostname = DOCS_HOSTNAME;

      const proxyRequest = new Request(proxyUrl, request);
      proxyRequest.headers.set("Host", DOCS_HOSTNAME);
      proxyRequest.headers.set("X-Forwarded-Host", SITE_HOSTNAME);
      proxyRequest.headers.set("X-Forwarded-Proto", "https");

      return fetch(proxyRequest);
    }

    return env.ASSETS.fetch(request);
  },
};
