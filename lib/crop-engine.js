/** Gray crop + JPEG encode. Thin vendored copy. */

import jpeg from "jpeg-js";

export function cropGrayFrame(source, request) {
  const norm = request.rect ?? { x: 0, y: 0, width: 1, height: 1 };
  const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(norm.x * source.width)));
  const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(norm.y * source.height)));
  const x1 = Math.max(
    x0 + 1,
    Math.min(source.width, Math.ceil((norm.x + norm.width) * source.width)),
  );
  const y1 = Math.max(
    y0 + 1,
    Math.min(source.height, Math.ceil((norm.y + norm.height) * source.height)),
  );
  const width = x1 - x0;
  const height = y1 - y0;
  const pixels = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const srcRow = (y0 + y) * source.stride + x0;
    const dstRow = y * width;
    pixels.set(source.pixels.subarray(srcRow, srcRow + width), dstRow);
  }

  return { width, height, pixels };
}

export function encodeGrayJpeg(frame, quality = 70) {
  const rgba = new Uint8Array(frame.width * frame.height * 4);
  for (let i = 0; i < frame.pixels.length; i++) {
    const g = frame.pixels[i];
    const o = i * 4;
    rgba[o] = g;
    rgba[o + 1] = g;
    rgba[o + 2] = g;
    rgba[o + 3] = 255;
  }
  const encoded = jpeg.encode(
    { data: Buffer.from(rgba), width: frame.width, height: frame.height },
    quality,
  );
  return new Uint8Array(encoded.data);
}

export function encodeEyedFrameJpeg(width, height, stride, pixels, request = {}, quality = 70) {
  const cropped = cropGrayFrame({ width, height, stride, pixels }, request);
  return encodeGrayJpeg(cropped, quality);
}

export function createNoVideoJpeg(width = 640, height = 360, message = "no video") {
  const pixels = new Uint8Array(width * height);
  pixels.fill(18);
  for (let x = 0; x < width; x++) {
    pixels[x] = 40;
    pixels[(height - 1) * width + x] = 40;
  }
  for (let y = 0; y < height; y++) {
    pixels[y * width] = 40;
    pixels[y * width + width - 1] = 40;
  }
  const bandY = Math.floor(height / 2) - 8;
  for (let y = 0; y < 16; y++) {
    for (let x = 24; x < width - 24; x++) {
      pixels[(bandY + y) * width + x] = 28;
    }
  }
  const seed = message.length * 17;
  for (let i = 0; i < message.length * 3; i++) {
    const x = 40 + ((i * 13 + seed) % (width - 80));
    const y = bandY + 4 + (i % 8);
    pixels[y * width + x] = 180;
  }
  return encodeGrayJpeg({ width, height, pixels }, 60);
}
