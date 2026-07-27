#!/usr/bin/env node
/**
 * PicoCam free-app CLI — ugly on purpose.
 * First usable ADB device. JSON crops. No UI. Ctrl+C to quit.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAdbForwarder,
  createMockAdbForwarder,
  isMockDeviceSerial,
  MOCK_DEVICE_SERIAL,
} from "./lib/adb-forwarder.js";
import { createNoVideoJpeg, encodeEyedFrameJpeg } from "./lib/crop-engine.js";
import {
  createFrameReader,
  createSimulatedFrameSource,
} from "./lib/frame-reader.js";
import { createMediaServer } from "./lib/media-server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_ID = "raw";
const RAW_PATH = "/raw";

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function usage() {
  console.log(`picocam free-app — CLI crumbs, not the real app

  node run.mjs [--mock] [--config path]
  pnpm start
  pnpm mock

Flags:
  --mock          fake headset frames (no adb)
  --config <path> config.json (default: ./config.json next to run.mjs)
  -h, --help      this

Config: copy config.example.json → config.json. Edit crops yourself.
Device: first usable serial from \`adb devices\` (state=device preferred).
Want a UI? GitHub Releases. This path is homework.
`);
}

function parseArgs(argv) {
  let mock = false;
  let configPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true };
    if (a === "--mock") {
      mock = true;
      continue;
    }
    if (a === "--config") {
      const next = argv[++i];
      if (!next) die(" --config needs a path. try harder.");
      configPath = next;
      continue;
    }
    die(`unknown flag: ${a}\ntry --help`);
  }
  return { help: false, mock, configPath };
}

function loadConfig(path) {
  if (!existsSync(path)) {
    die(
      `no config at ${path}\ncopy config.example.json → config.json and stop guessing.`,
    );
  }
  let raw;
  try {
    const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    raw = JSON.parse(text);
  } catch (e) {
    die(`config.json is garbage JSON: ${e.message}`);
  }
  return normalizeConfig(raw);
}

function normalizeConfig(raw) {
  const host = raw.host ?? raw.mediaHost ?? "0.0.0.0";
  const port = Number(raw.port ?? raw.mediaPort ?? 23433);
  const forwardPort = Number(raw.forwardPort ?? 28900);
  const sockPath =
    raw.sockPath ?? raw.deviceSock ?? "/data/local/tmp/eyed.sock";
  const adbPath =
    typeof raw.adbPath === "string" && raw.adbPath.trim()
      ? raw.adbPath.trim()
      : null;
  const mock = Boolean(raw.mock);

  const endpoints = [];
  const list = Array.isArray(raw.endpoints) ? raw.endpoints : [];
  for (let i = 0; i < list.length; i++) {
    const ep = list[i];
    if (!ep || typeof ep !== "object") continue;
    const path = String(ep.path ?? "").trim();
    if (!path) continue;

    let x;
    let y;
    let w;
    let h;
    if (ep.crop && typeof ep.crop === "object") {
      x = Number(ep.crop.x);
      y = Number(ep.crop.y);
      w = Number(ep.crop.width ?? ep.crop.w);
      h = Number(ep.crop.height ?? ep.crop.h);
    } else {
      x = Number(ep.x);
      y = Number(ep.y);
      w = Number(ep.w ?? ep.width);
      h = Number(ep.h ?? ep.height);
    }
    if (![x, y, w, h].every((n) => Number.isFinite(n))) {
      die(`endpoint ${path}: need numeric x,y,w,h (or crop.{x,y,width,height})`);
    }
    const id = String(ep.id ?? (path.replace(/^\//, "") || `ep${i}`));
    const enabled = ep.enabled !== false;
    endpoints.push({
      id,
      path: path.startsWith("/") ? path : `/${path}`,
      enabled,
      rect: { x, y, width: w, height: h },
    });
  }

  return { host, port, forwardPort, sockPath, adbPath, mock, endpoints };
}

/** Prefer state=device; skip unauthorized/offline when anything else exists. */
function pickFirstDevice(devices) {
  const ready = devices.filter((d) => d.state === "device");
  if (ready.length) return ready[0];
  const notBroken = devices.filter(
    (d) => d.state !== "unauthorized" && d.state !== "offline",
  );
  if (notBroken.length) return notBroken[0];
  return null;
}

function publicBase(host, port) {
  const h = host === "0.0.0.0" ? "127.0.0.1" : host;
  return `http://${h}:${port}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const configFile = args.configPath
    ? isAbsolute(args.configPath)
      ? args.configPath
      : resolve(process.cwd(), args.configPath)
    : join(__dirname, "config.json");

  const cfg = loadConfig(configFile);
  const useMock = args.mock || cfg.mock;

  const media = createMediaServer();
  const reader = createFrameReader();
  const placeholder = createNoVideoJpeg(640, 360, "no video");
  let forwardHandle = null;
  let sim = null;
  let unsub = null;
  let shuttingDown = false;

  const publishFrame = (frame) => {
    const { width, height, stride } = frame.header;
    const pixels = frame.payload;
    media.publishJpeg(
      RAW_ID,
      encodeEyedFrameJpeg(width, height, stride, pixels, {
        rect: { x: 0, y: 0, width: 1, height: 1 },
      }),
    );
    for (const ep of cfg.endpoints) {
      if (!ep.enabled) {
        media.publishJpeg(ep.id, null);
        continue;
      }
      media.publishJpeg(
        ep.id,
        encodeEyedFrameJpeg(width, height, stride, pixels, { rect: ep.rect }),
      );
    }
  };

  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error("shutting down...");
    try {
      unsub?.();
      unsub = null;
      sim?.stop();
      sim = null;
      await reader.disconnect();
      await media.stop();
      await forwardHandle?.close();
      forwardHandle = null;
    } catch (e) {
      console.error("cleanup hiccup:", e.message);
    }
  };

  process.on("SIGINT", () => {
    void cleanup().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void cleanup().then(() => process.exit(0));
  });

  let serial;
  let adb;

  if (useMock) {
    adb = createMockAdbForwarder();
    serial = MOCK_DEVICE_SERIAL;
    console.error(`mock mode - serial ${serial}`);
  } else {
    adb = createAdbForwarder({
      defaultAdbPath: cfg.adbPath ?? undefined,
    });
    if (!(await adb.isAvailable())) {
      die("adb not found. put it on PATH or set adbPath in config.json.");
    }
    let devices;
    try {
      devices = await adb.listDevices();
    } catch (e) {
      die(`adb devices failed: ${e.message}`);
    }
    const picked = pickFirstDevice(devices);
    if (!picked) {
      const states = devices.map((d) => `${d.serial}:${d.state}`).join(", ");
      die(
        states
          ? `no usable adb device (got: ${states}). unlock / authorize / plug the headset.`
          : "no adb devices. plug the Pico headset. authorize USB. try again.",
      );
    }
    serial = picked.serial;
    console.error(`using first device: ${serial} (${picked.state})`);
  }

  await media.start({
    host: cfg.host,
    port: cfg.port,
    placeholderJpeg: placeholder,
    placeholderIntervalMs: 800,
  });

  media.upsertRoute({ id: RAW_ID, path: RAW_PATH, enabled: true });
  media.publishJpeg(RAW_ID, null);
  for (const ep of cfg.endpoints) {
    media.upsertRoute({ id: ep.id, path: ep.path, enabled: ep.enabled });
    media.publishJpeg(ep.id, null);
  }

  const base = publicBase(cfg.host, cfg.port);
  console.error(`media ${base}`);
  console.error(`  ${base}${RAW_PATH}`);
  for (const ep of cfg.endpoints) {
    console.error(`  ${base}${ep.path}${ep.enabled ? "" : " (disabled)"}`);
  }

  if (isMockDeviceSerial(serial) || useMock) {
    sim = createSimulatedFrameSource(640, 360);
    unsub = sim.onFrame(publishFrame);
    sim.start(12);
    console.error("feeding mock frames. Ctrl+C to stop.");
  } else {
    try {
      forwardHandle = await adb.forward({
        adbPath: cfg.adbPath ?? undefined,
        serial,
        localPort: cfg.forwardPort,
        deviceSock: cfg.sockPath,
      });
    } catch (e) {
      await cleanup();
      die(`forward failed: ${e.message}`);
    }
    console.error(
      `forward tcp:${cfg.forwardPort} → ${cfg.sockPath} on ${serial}`,
    );

    unsub = reader.onFrame(publishFrame);
    reader.onStale(() => {
      media.publishJpeg(RAW_ID, null);
      for (const ep of cfg.endpoints) media.publishJpeg(ep.id, null);
    });

    try {
      await reader.connect({ host: "127.0.0.1", port: cfg.forwardPort });
    } catch (e) {
      await cleanup();
      die(`tcp connect to forwarded port failed: ${e.message}`);
    }
    console.error("streaming. Ctrl+C to stop. (releases has a nicer life)");
  }
}

main().catch(async (e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
