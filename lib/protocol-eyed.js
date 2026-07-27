/** Eyed socket frame protocol (magic, header layout). Thin vendored copy. */

export const EYED_MAGIC = 3394168800;
export const EYED_HEADER_SIZE = 24;

/**
 * Parse a 24-byte little-endian eyed header.
 * @param {Uint8Array} buffer
 * @returns {{ magic: number, width: number, height: number, stride: number, size: number, seq: number } | null}
 */
export function parseEyedHeader(buffer) {
  if (buffer.byteLength < EYED_HEADER_SIZE) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== EYED_MAGIC) return null;
  return {
    magic,
    width: view.getUint32(4, true),
    height: view.getUint32(8, true),
    stride: view.getUint32(12, true),
    size: view.getUint32(16, true),
    seq: view.getUint32(20, true),
  };
}

export function isEyedMagic(value) {
  return value === EYED_MAGIC;
}
