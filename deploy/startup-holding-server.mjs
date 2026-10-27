// Answers on the app's port while docker-entrypoint.sh applies migrations and
// syncs templates (#1263), so a request during a restart gets a short 503 JSON
// "updating" answer the forms understand, not a gateway error page. The
// entrypoint stops it before it starts the app. Plain Node, no dependencies.
import { createServer } from "node:http";

const port = Number(process.env.PORT || 3000);
const message = "The site is updating. Your answers are still here — try again in a minute.";

const server = createServer((request, response) => {
  const wantsJson = (request.url || "").startsWith("/api/")
    || (request.headers.accept || "").includes("application/json");
  response.statusCode = 503;
  response.setHeader("Retry-After", "15");
  response.setHeader("Cache-Control", "no-store");
  if (wantsJson) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ code: "UPDATING", message }));
  } else {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="15"><title>Updating</title></head>`
      + `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;line-height:1.5">`
      + `<h1 style="font-size:1.5rem">The site is updating</h1><p>Please wait a minute. This page reloads by itself.</p></body></html>`,
    );
  }
});

server.listen(port, "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    // Never hold up the app's start for a slow client.
    server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
