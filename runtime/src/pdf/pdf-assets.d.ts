/**
 * Type declarations for Vite asset imports used by the PDF
 * generator.
 *
 * - `?url` resolves a static asset to a fetch-able URL string.
 * - `@pdf-lib/fontkit` ships ESM but its types are in CommonJS
 *   format; declare the module shape we use here.
 */

declare module '*.ttf?url' {
  const url: string;
  export default url;
}

declare module '@pdf-lib/fontkit' {
  // pdf-lib accepts a `Fontkit`-shaped object via registerFontkit.
  // We only consume the default export, opaquely.
  const fontkit: unknown;
  export default fontkit;
}
