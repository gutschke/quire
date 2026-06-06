/**
 * Font loader for the PDF generator.
 *
 * v2 (2026-06-06): switch from StandardFonts (Helvetica/Times) to
 * embedded Liberation Sans + Serif via fontkit.  This was the
 * single highest-leverage fix from the v1.1 critique: it eliminates
 * the `asciify` table (the source of literal `*` separators that
 * looked like leftover markdown) and unlocks Unicode `·`, `→`,
 * `≤`, `—`, `…`, real italic emphasis from markdown, etc.
 *
 * Liberation fonts (SIL OFL 1.1) are metrically compatible with
 * Arial / Times so the v1 size/leading tuning stays close to right.
 * See ./fonts/LICENSE.txt for the OFL trail.
 *
 * Loading: in the browser the TTFs are Vite `?url` static assets
 * the lazy print-pc chunk fetches on first use; in Node (vitest +
 * scripts) we read the same files from disk.  Both paths return
 * the same `FontBytes` shape.
 */

import sansRegularUrl from './fonts/LiberationSans-Regular.ttf?url';
import sansBoldUrl from './fonts/LiberationSans-Bold.ttf?url';
import serifRegularUrl from './fonts/LiberationSerif-Regular.ttf?url';
import serifItalicUrl from './fonts/LiberationSerif-Italic.ttf?url';

export interface FontBytes {
  sansRegular: Uint8Array;
  sansBold: Uint8Array;
  serifRegular: Uint8Array;
  serifItalic: Uint8Array;
}

/**
 * Detect a browser-like environment.  happy-dom sets `window` but
 * its fetch struggles with `?url` Vite-resolved file:// URLs, so we
 * prefer the Node path under tests (which set process.env.NODE_ENV).
 */
function isBrowserRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof process === 'undefined'
  );
}

async function loadViaFetch(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`font fetch failed: ${url} (${r.status})`);
  const buf = await r.arrayBuffer();
  return new Uint8Array(buf);
}

async function loadViaFs(url: string): Promise<Uint8Array> {
  const fs = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  // Vite/Vitest resolves the `?url` import to a file:// URL string
  // in node; convert and read.  In bare-node script use (where the
  // import path is the raw `./fonts/Foo.ttf` filename), strip
  // ./fonts/ and look it up alongside this module.
  if (url.startsWith('file://')) {
    return new Uint8Array(await fs.readFile(fileURLToPath(url)));
  }
  // Fallback: resolve relative to this module.
  const path = await import('node:path');
  const { dirname } = path;
  const here =
    typeof import.meta.url === 'string'
      ? dirname(fileURLToPath(import.meta.url))
      : __dirname;
  const name = url.split('/').pop() ?? url;
  return new Uint8Array(await fs.readFile(path.join(here, 'fonts', name)));
}

export async function loadFontBytes(): Promise<FontBytes> {
  const loader = isBrowserRuntime() ? loadViaFetch : loadViaFs;
  const [sansRegular, sansBold, serifRegular, serifItalic] = await Promise.all([
    loader(sansRegularUrl),
    loader(sansBoldUrl),
    loader(serifRegularUrl),
    loader(serifItalicUrl)
  ]);
  return { sansRegular, sansBold, serifRegular, serifItalic };
}
