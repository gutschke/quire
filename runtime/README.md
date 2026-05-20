# Quire runtime

The browser-based play app. Static bundle deployed to Cloudflare Pages at `play.quire.games`.

## Status

Phase 1, scaffold cut. The runtime builds, loads in a browser, and reads the `?campaign=` URL parameter. Real campaign loading, schema validation in the browser, the reference-shelf UI, and the play surface land in subsequent commits.

## Build

```
cd runtime/
npm install
npm run dev      # local dev server at http://localhost:5173
npm run build    # type-checks + produces dist/ for deployment
npm run preview  # serve the built bundle locally
```

Requires Node 18 or newer.

## Deploy

The runtime deploys to Cloudflare Pages connected to this repository's `runtime/` subdirectory. The `public/_headers` file configures CSP and other security headers; Cloudflare Pages applies them automatically.

See [`design/architecture.md`](../design/architecture.md) for the hosting and security model.

## Stack

- **Vite 5** — build tool and dev server.
- **TypeScript 5** — typed JavaScript.
- **Lit 3** — web-components UI library; small (~10 KB), no virtual DOM.

These choices are about minimizing runtime weight on phones and keeping the bundle understandable. The runtime aims to stay under ~250 KB after gzip when feature-complete.

## Layout

```
runtime/
├── index.html               entry HTML
├── public/
│   └── _headers             Cloudflare Pages security headers
├── src/
│   ├── main.ts              app bootstrap
│   └── quire-app.ts         root Lit component (phase 1 placeholder)
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## License

MIT (see [../LICENSE](../LICENSE)).
