# PicoCam

Pico headset camera in. MJPEG webcam out. Dark red vibes optional — paying the bills is not.

PicoCam talks ADB to a composite cam stream on your Pico headset, crops what you want, and serves **HTTP MJPEG endpoints** that OBS, browsers, VLC, and friends can treat like a webcam feed. No cloud middleman for the video path — your PC, your device, your streams.

## This is a paid product

Money does not grow on trees. This is not Roblox. PicoCam is something I sell so I can keep shipping it.

| | |
|--|--|
| **Free desktop** | Real app. Device picker, crop UI, endpoints. May remind you premium exists. That's the deal. |
| **Paid / Premium** | Same app, chill experience (and whatever else the key unlocks). Buy a key. Enter the key. Life continues. |
| **Free keys?** | Sometimes, if I'm feeling generous. Not a promise. Not a support tier. Chill means chill. |

### Get the real app (do this)

Don't clone-and-pray. Grab a release:

**[GitHub Releases — ReinadoRojo/picocam](https://github.com/ReinadoRojo/picocam/releases)**

Download Setup.exe → install → plug the Pico headset → go.

## What this repo is

**CLI crumbs.** A blunt Node runner that picks the **first usable ADB device**, reads crop rects from JSON, and serves MJPEG. No Electron. No crop painter. No device picker UI. Intentionally low customization.

Want streams that don’t feel like homework? Download Free or Paid from Releases.

### Hard way (this CLI)

Needs Node 20+, `pnpm` (or npm), and `adb` on PATH (unless `--mock`).

```bash
cp config.example.json config.json   # edit crops yourself
pnpm install
pnpm start                           # or: node run.mjs
pnpm mock                            # fake frames, no headset
```

Flags: `--mock`, `--config <path>`, `-h`. That’s it.

Device rule: first serial from `adb devices` with state `device`. Skips `unauthorized` / `offline` when something better exists. No picker. Wrong headset plugged in first? Your problem — or use the desktop app.

Config fields (minimal): `host`, `port`, `forwardPort`, `sockPath`, `endpoints[{path,x,y,w,h}]`, optional `mock`, optional `adbPath`. Normalized crops `0..1`. Copy the example; don’t ask for a schema wizard.

`lib/` is vendored stream glue so this folder can run without the private monorepo. Releases is still the easy path.

## What you will not find here

- Desktop installer source / Electron UI  
- Auth / license backend  
- Pretty logs, update chrome, endpoint designer  

If this folder feels annoying: good. That’s the product pitch working.

---

Built with caffeine and the firm belief that useful software can cost money. If you like PicoCam, buy it. If you don’t, that’s fine too — just grab Free from Releases and enjoy the headset feed.

Buy it:
\[soon, give me like 5 days or smt pls. thonks\]
