# What to publish

PicoCam’s **product** is the desktop installer on **GitHub Releases** (Free + Paid). The **public GitHub repo** should contain **only** the contents of `free-app/` — flat at repo root. No monorepo. No desktop source. No private packages.

## Public repo = upload `free-app/*` as root

Copy (or sparse-publish) these so they sit at the **root** of the public repo:

| Path | Why |
|------|-----|
| `README.md` | Paid-product pitch + Releases + CLI hard-way notes |
| `config.example.json` | Sample crop / endpoint shape |
| `package.json` | Node deps (`jpeg-js`) + `pnpm start` |
| `run.mjs` | CLI entry |
| `lib/` | Vendored stream glue (adb / frames / crop / MJPEG) so the public tree can actually run |
| `PUBLISH.md` | This file (optional) |

After upload, the public layout looks like:

```
README.md
config.example.json
package.json
run.mjs
lib/
PUBLISH.md   (optional)
```

Not `free-app/…`, not `apps/…`, not monorepo `packages/…`.

## Do not upload

| Path / pattern | Why |
|----------------|-----|
| `apps/` (desktop, auth-server, …) | Full client / backend — private |
| monorepo `packages/` | Shared source — private; free-app vendors what it needs under `lib/` |
| Root monorepo plumbing (`pnpm-workspace.yaml`, root `package.json`, …) | Public repo is not the monorepo |
| `docs/` (unless you explicitly want a doc there) | Optional |
| `*.pem`, `*.key`, `.env*` | Secrets |
| `release/`, `*.exe`, unpacked installer dirs | Ship via **Releases**, not git |
| `*.sqlite`, auth data / seed keys | Private |
| `config.json` | Local edits only (gitignored); ship the example |
| `node_modules/` | Install on the user’s machine |

**Do not delete** local `apps/desktop` (or the rest of the monorepo) from disk just to publish. Keep building installers locally; upload **artifacts** to GitHub Releases. Omit everything except `free-app/` contents from the public push.

## Releases = real app

| Tier | Where |
|------|--------|
| **Free desktop** | GitHub Releases installer (UI, crops, reminders OK) |
| **Paid / Premium desktop** | Same installer + key (your backend, not this repo) |
| **Public git tree** | Ugly CLI + config example — runnable, not friendly |

Point most users at Releases. The CLI is for people who insist on JSON and first-device ADB selection.
