/** Local HTTP MJPEG routes. Thin vendored copy. */

import http from "node:http";

const BOUNDARY = "picocamframe";

function normalizePath(path) {
  if (!path.startsWith("/")) return `/${path}`;
  return path.replace(/\/+$/, "") || "/";
}

function writeJpegPart(res, jpeg) {
  res.write(`--${BOUNDARY}\r\n`);
  res.write("Content-Type: image/jpeg\r\n");
  res.write(`Content-Length: ${jpeg.byteLength}\r\n\r\n`);
  res.write(Buffer.from(jpeg));
  res.write("\r\n");
}

export function createMediaServer() {
  const routes = new Map();
  const latest = new Map();
  const clients = new Map();

  let server = null;
  let bound = null;
  let placeholderJpeg = null;
  let placeholderTimer = null;

  function routeByPath(pathname) {
    const want = normalizePath(pathname);
    for (const route of routes.values()) {
      if (normalizePath(route.path) === want) return route;
    }
    return undefined;
  }

  function jpegForRoute(route) {
    if (!route.enabled) return placeholderJpeg;
    const frame = latest.get(route.id);
    if (frame && frame.byteLength > 0) return frame;
    return placeholderJpeg;
  }

  function attachClient(routeId, res) {
    let set = clients.get(routeId);
    if (!set) {
      set = new Set();
      clients.set(routeId, set);
    }
    set.add(res);
    res.on("close", () => set?.delete(res));
  }

  function broadcast(routeId, jpeg) {
    const set = clients.get(routeId);
    if (!set) return;
    for (const res of [...set]) {
      if (res.writableEnded) {
        set.delete(res);
        continue;
      }
      try {
        writeJpegPart(res, jpeg);
      } catch {
        set.delete(res);
      }
    }
  }

  function handleRequest(req, res) {
    const host = req.headers.host ?? "127.0.0.1";
    const url = new URL(req.url ?? "/", `http://${host}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          routes: [...routes.values()].map((r) => normalizePath(r.path)),
        }),
      );
      return;
    }

    const route = routeByPath(url.pathname);
    if (!route) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("endpoint not found");
      return;
    }

    res.writeHead(200, {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Connection: "close",
      "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      "Access-Control-Allow-Origin": "*",
    });

    attachClient(route.id, res);
    const first = jpegForRoute(route);
    if (first) writeJpegPart(res, first);
  }

  return {
    async start(options = {}) {
      if (server) return bound;

      const host = options.host ?? "0.0.0.0";
      const port = options.port ?? 23433;
      placeholderJpeg = options.placeholderJpeg ?? null;
      const placeholderIntervalMs = options.placeholderIntervalMs ?? 1000;

      server = http.createServer(handleRequest);

      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve());
      });

      bound = { host, port };

      placeholderTimer = setInterval(() => {
        for (const route of routes.values()) {
          const jpeg = jpegForRoute(route);
          if (jpeg) broadcast(route.id, jpeg);
        }
      }, placeholderIntervalMs);

      return bound;
    },

    async stop() {
      if (placeholderTimer) {
        clearInterval(placeholderTimer);
        placeholderTimer = null;
      }
      for (const set of clients.values()) {
        for (const res of set) {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
        set.clear();
      }
      clients.clear();

      const s = server;
      server = null;
      bound = null;
      if (!s) return;
      await new Promise((resolve) => s.close(() => resolve()));
    },

    upsertRoute(route) {
      const next = { ...route, path: normalizePath(route.path) };
      routes.set(next.id, next);
      if (!latest.has(next.id)) latest.set(next.id, null);
    },

    removeRoute(id) {
      routes.delete(id);
      latest.delete(id);
      const set = clients.get(id);
      if (set) {
        for (const res of set) {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
        clients.delete(id);
      }
    },

    listRoutes() {
      return [...routes.values()];
    },

    publishJpeg(routeId, jpeg) {
      latest.set(routeId, jpeg);
      if (jpeg) broadcast(routeId, jpeg);
    },

    isRunning() {
      return server != null;
    },

    getBoundAddress() {
      return bound;
    },
  };
}
