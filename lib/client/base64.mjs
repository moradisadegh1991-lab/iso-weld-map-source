/**
 * Base64 for a whole file, without handing the engine a million arguments.
 *
 * The obvious one-liner is a trap:
 *
 *     btoa(String.fromCharCode(...new Uint8Array(buf)))
 *
 * The spread turns every byte into a separate function argument, so a 2.7 MB
 * isometric PDF calls String.fromCharCode with 2.7 million of them and the
 * engine throws "Maximum call stack size exceeded". It is a size-dependent
 * failure, which is why it survived: every drawing tested during development
 * was a JPEG small enough to squeak through, and the first real multi-sheet
 * PDF — the one this whole feature exists for — was the thing that broke it.
 *
 * Chunking keeps each call's argument count far below any engine's limit
 * while still letting String.fromCharCode do the work in bulk.
 */

/** Well under the ~65k argument ceiling the engines actually enforce. */
const CHUNK = 0x8000;

/**
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {string} standard base64, as btoa produces it
 */
export function base64FromBuffer(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
