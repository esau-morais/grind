import { writeFileSync } from "node:fs";
import { getOAuthPendingPath } from "@grindxp/core";
import { createFileRoute } from "@tanstack/react-router";

const c = {
  background: "#050506",
  card: "#0c0c0e",
  border: "#1f1f22",
  foreground: "#fafafa",
  muted: "#8e8e98",
  success: "#22c560",
  error: "#f14d4c",
  orange: "#ff6c02",
};

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          try {
            writeFileSync(
              getOAuthPendingPath(),
              JSON.stringify({ error, state: state ?? "", ts: Date.now() }),
            );
          } catch {}
          return new Response(callbackHtml(false, `Authentication failed: ${error}`), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          });
        }

        if (!code || !state) {
          return new Response(callbackHtml(false, "Missing authorization code or state."), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          });
        }

        try {
          writeFileSync(getOAuthPendingPath(), JSON.stringify({ code, state, ts: Date.now() }));
        } catch {
          return new Response(
            callbackHtml(false, "Failed to save authorization code. Check server logs."),
            { status: 500, headers: { "Content-Type": "text/html" } },
          );
        }

        return new Response(callbackHtml(true, "You can close this tab and return to grind."), {
          headers: { "Content-Type": "text/html" },
        });
      },
    },
  },
});

function callbackHtml(success: boolean, message: string): string {
  const title = success ? "Authenticated" : "Authentication Failed";
  const accent = success ? c.success : c.error;
  const icon = success
    ? `<svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" stroke="${accent}" stroke-width="1.5"/><path d="M12 20.5l5.5 5.5 10.5-11" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" stroke="${accent}" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M14 14l12 12M26 14L14 26" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>grind — ${title}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Geist Variable', 'Geist', system-ui, sans-serif;
        background: ${c.background};
        color: ${c.foreground};
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100dvh;
      }
      .card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 2.5rem 3rem;
        border: 1px solid ${c.border};
        border-radius: 12px;
        background: ${c.card};
        text-align: center;
        max-width: 360px;
        width: 100%;
      }
      .wordmark {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: ${c.orange};
        margin-bottom: 4px;
      }
      h1 {
        font-size: 1.125rem;
        font-weight: 600;
        color: ${accent};
        line-height: 1.3;
      }
      p {
        font-size: 0.875rem;
        color: ${c.muted};
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <span class="wordmark">GRIND</span>
      ${icon}
      <div>
        <h1>${title}</h1>
        <p>${message}</p>
      </div>
    </div>
  </body>
</html>`;
}
