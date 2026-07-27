/** TCP frame client + simulated source. Thin vendored copy. */

import net from "node:net";
import { EYED_HEADER_SIZE, EYED_MAGIC, parseEyedHeader } from "./protocol-eyed.js";

function readExact(socket, size, buffer) {
  return new Promise((resolve, reject) => {
    let offset = 0;
    const onData = (chunk) => {
      const need = size - offset;
      const take = Math.min(need, chunk.length);
      chunk.copy(buffer, offset, 0, take);
      offset += take;
      if (offset >= size) {
        cleanup();
        const rest = chunk.subarray(take);
        if (rest.length) socket.unshift(rest);
        resolve(buffer);
      }
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("socket closed while reading"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

export function createFrameReader() {
  let latest = null;
  let socket = null;
  let running = false;
  let staleTimer = null;
  const listeners = new Set();
  const staleListeners = new Set();
  let staleAfterMs = 2000;

  const bumpFresh = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      for (const l of staleListeners) l();
    }, staleAfterMs);
  };

  const emit = (frame) => {
    latest = frame;
    bumpFresh();
    for (const l of listeners) l(frame);
  };

  const loop = async () => {
    while (running && socket) {
      const hdrBuf = Buffer.alloc(EYED_HEADER_SIZE);
      await readExact(socket, EYED_HEADER_SIZE, hdrBuf);
      let header = parseEyedHeader(new Uint8Array(hdrBuf));
      if (!header) {
        const view = new DataView(hdrBuf.buffer, hdrBuf.byteOffset, hdrBuf.byteLength);
        let found = -1;
        for (let i = 0; i <= EYED_HEADER_SIZE - 4; i++) {
          if (view.getUint32(i, true) === EYED_MAGIC) {
            found = i;
            break;
          }
        }
        if (found <= 0) continue;
        const keep = hdrBuf.subarray(found);
        const need = EYED_HEADER_SIZE - keep.length;
        const rest = Buffer.alloc(need);
        await readExact(socket, need, rest);
        const full = Buffer.concat([keep, rest]);
        header = parseEyedHeader(new Uint8Array(full));
        if (!header) continue;
      }

      const payload = Buffer.alloc(header.size);
      await readExact(socket, header.size, payload);
      emit({ header, payload: new Uint8Array(payload) });
    }
  };

  return {
    async connect(options = {}) {
      await this.disconnect();
      staleAfterMs = options.staleAfterMs ?? 2000;
      const host = options.host ?? "127.0.0.1";
      const port = options.port ?? 28900;

      socket = await new Promise((resolve, reject) => {
        const s = net.connect({ host, port }, () => resolve(s));
        s.once("error", reject);
      });
      running = true;
      void loop().catch(() => {
        running = false;
      });
    },

    async disconnect() {
      running = false;
      if (staleTimer) {
        clearTimeout(staleTimer);
        staleTimer = null;
      }
      if (socket) {
        socket.destroy();
        socket = null;
      }
      latest = null;
    },

    onFrame(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onStale(listener) {
      staleListeners.add(listener);
      return () => staleListeners.delete(listener);
    },

    getLatest() {
      return latest;
    },

    isConnected() {
      return running && socket != null;
    },
  };
}

export function createSimulatedFrameSource(width = 640, height = 360) {
  const stride = width;
  const listeners = new Set();
  let latest = null;
  let timer = null;
  let seq = 0;

  const tick = () => {
    seq = (seq + 1) >>> 0;
    const payload = new Uint8Array(stride * height);
    const cw = Math.floor(width / 2);
    const ch = Math.floor(height / 2);
    const bases = [40, 70, 55, 85];
    for (let q = 0; q < 4; q++) {
      const ox = q % 2 === 0 ? 0 : cw;
      const oy = q < 2 ? 0 : ch;
      const base = bases[q];
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const wave = (x + seq * (2 + q) + y) % 64;
          payload[(oy + y) * stride + (ox + x)] = base + wave;
        }
      }
      for (let y = 8; y < 20; y++) {
        for (let x = 10; x < 40; x++) {
          payload[(oy + y) * stride + (ox + x)] = 200;
        }
      }
    }

    const frame = {
      header: {
        magic: EYED_MAGIC,
        width,
        height,
        stride,
        size: payload.byteLength,
        seq,
      },
      payload,
    };
    latest = frame;
    for (const l of listeners) l(frame);
  };

  return {
    start(fps = 12) {
      this.stop();
      tick();
      timer = setInterval(tick, Math.max(16, Math.floor(1000 / fps)));
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    onFrame(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLatest() {
      return latest;
    },
  };
}
