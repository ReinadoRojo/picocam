/** ADB detect + forward + teardown. Thin vendored copy. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_ADB_PORT = 28900;
export const DEFAULT_DEVICE_SOCK = "/data/local/tmp/eyed.sock";
export const MOCK_DEVICE_SERIAL = "picocam-sim-01";

export function isMockDeviceSerial(serial) {
  return Boolean(serial?.startsWith("picocam-sim-"));
}

function adbBin(adbPath) {
  return adbPath?.trim() || "adb";
}

async function runAdb(adbPath, args) {
  const { stdout } = await execFileAsync(adbBin(adbPath), args, {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.toString();
}

/**
 * @param {{ defaultAdbPath?: string | (() => string | undefined) }} [options]
 */
export function createAdbForwarder(options = {}) {
  const resolvePath = (override) => {
    if (override?.trim()) return override.trim();
    const raw =
      typeof options.defaultAdbPath === "function"
        ? options.defaultAdbPath()
        : options.defaultAdbPath;
    return raw?.trim() || "adb";
  };

  return {
    async isAvailable() {
      try {
        await runAdb(resolvePath(), ["version"]);
        return true;
      } catch {
        return false;
      }
    },

    async listDevices() {
      const out = await runAdb(resolvePath(), ["devices"]);
      const devices = [];
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("List of devices")) continue;
        const [serial, state] = trimmed.split(/\s+/);
        if (serial && state) devices.push({ serial, state });
      }
      return devices;
    },

    async forward(forwardOptions = {}) {
      const localPort = forwardOptions.localPort ?? DEFAULT_ADB_PORT;
      const deviceSock = forwardOptions.deviceSock ?? DEFAULT_DEVICE_SOCK;
      const bin = resolvePath(forwardOptions.adbPath);
      const args = [
        ...(forwardOptions.serial ? ["-s", forwardOptions.serial] : []),
        "forward",
        `tcp:${localPort}`,
        `localfilesystem:${deviceSock}`,
      ];
      await runAdb(bin, args);
      return {
        localPort,
        deviceSock,
        serial: forwardOptions.serial,
        mock: false,
        async close() {
          try {
            await runAdb(bin, [
              ...(forwardOptions.serial ? ["-s", forwardOptions.serial] : []),
              "forward",
              "--remove",
              `tcp:${localPort}`,
            ]);
          } catch {
            /* already gone */
          }
        },
      };
    },
  };
}

export function createMockAdbForwarder(serial = MOCK_DEVICE_SERIAL) {
  return {
    async isAvailable() {
      return true;
    },
    async listDevices() {
      return [{ serial, state: "device", mock: true }];
    },
    async forward(options = {}) {
      return {
        localPort: options.localPort ?? DEFAULT_ADB_PORT,
        deviceSock: options.deviceSock ?? DEFAULT_DEVICE_SOCK,
        serial: options.serial ?? serial,
        mock: true,
        async close() {
          /* no-op */
        },
      };
    },
  };
}
