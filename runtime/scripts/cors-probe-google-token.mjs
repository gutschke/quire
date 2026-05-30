#!/usr/bin/env node
/**
 * CORS probe for Google's OAuth2 token endpoint (M6a, OP-016).
 *
 * Purpose: BEFORE writing any M6a code, verify that
 * `https://oauth2.googleapis.com/token` accepts cross-origin
 * POST requests from a browser-context Origin.  Google's docs
 * say PKCE public clients should work CORS-permitted, but
 * real-world behavior varies by Google's edge config.
 *
 * If CORS is OPEN, M6a ships as designed (browser-side token
 * exchange, no Worker proxy needed).  If CORS is BLOCKED,
 * DEC-018 kicks in (Worker fallback requires explicit DEC).
 *
 * This probe runs in Node (server-side fetch), which doesn't
 * itself enforce CORS — so we can't just send a request and
 * check for failure.  Instead, we send a preflight-style OPTIONS
 * request with our prospective production origin in the
 * `Origin` header and inspect the response headers to see what
 * Google would tell a browser.
 *
 * We also send a real POST with deliberately bogus payload
 * (no real credentials!) and check that:
 *   1. The endpoint returns a structured JSON error (proving
 *      we reached it without infrastructure-side blocking).
 *   2. The response carries the CORS allow-origin header
 *      matching our origin (or `*`).
 *
 * Usage:
 *   node scripts/cors-probe-google-token.mjs [--origin https://example.com]
 *
 * Default origin: https://quire.pages.dev (Cloudflare Pages
 * production).  Override with --origin to test staging or
 * localhost.
 *
 * Exit codes:
 *   0  CORS appears open for our origin.
 *   1  CORS is blocked OR endpoint is unreachable OR response
 *      shape unexpected.  See OP-016 + DEC-018 for fallback.
 *
 * Manual run only (NOT in `npm test` — requires network and
 * makes a real request to Google's edge).
 */

const DEFAULT_ORIGIN = 'https://quire.pages.dev';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function parseArgs(argv) {
  const out = { origin: DEFAULT_ORIGIN };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--origin' && argv[i + 1]) {
      out.origin = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function preflight(origin) {
  // OPTIONS preflight as a browser would send for a POST with
  // Content-Type: application/x-www-form-urlencoded.  The body
  // is simple, so a strict CORS check might skip preflight in
  // practice — but Google's edge may still return Access-Control-
  // Allow-Origin on POST directly.  Run both.
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  return {
    status: res.status,
    allowOrigin: res.headers.get('access-control-allow-origin'),
    allowMethods: res.headers.get('access-control-allow-methods'),
    allowHeaders: res.headers.get('access-control-allow-headers')
  };
}

async function actualPost(origin) {
  // Deliberately bogus payload.  No real auth code, no real
  // client_id, no real PKCE verifier.  The endpoint will
  // respond with `invalid_grant` or `invalid_request` — which
  // proves CORS is open enough that the response actually
  // reached us.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: 'PROBE_BOGUS_CODE_DO_NOT_USE',
    client_id: 'PROBE_BOGUS_CLIENT_ID.apps.googleusercontent.com',
    code_verifier: 'PROBE_BOGUS_VERIFIER_' + 'x'.repeat(50),
    redirect_uri: origin + '/auth/google/callback'
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: res.status,
    allowOrigin: res.headers.get('access-control-allow-origin'),
    bodyShape: json
      ? Object.keys(json).sort().join(',')
      : '<not-json>'
  };
}

function classify(preflightResult, postResult, origin) {
  // Browser semantics: CORS is "open" iff the server returned an
  // Access-Control-Allow-Origin header matching our origin OR
  // the wildcard `*`.  (For credentialed requests `*` doesn't
  // count, but PKCE public-client token exchange is NOT
  // credentialed — no cookies, no Authorization header.)
  const allowOriginPost = postResult.allowOrigin;
  const allowOriginPreflight = preflightResult.allowOrigin;
  const matches = (v) => v === '*' || v === origin;
  const corsOnPost = matches(allowOriginPost);
  const corsOnPreflight = matches(allowOriginPreflight);

  // Body shape sanity: a JSON error response with `error` and
  // `error_description` fields means we actually reached Google's
  // token endpoint logic.
  const hasErrorShape =
    typeof postResult.bodyShape === 'string' &&
    postResult.bodyShape.includes('error');

  return {
    corsOnPost,
    corsOnPreflight,
    hasErrorShape,
    verdict:
      corsOnPost && hasErrorShape
        ? 'OPEN'
        : !corsOnPost && hasErrorShape
          ? 'BLOCKED (response reached us but no allow-origin)'
          : !hasErrorShape
            ? 'UNKNOWN (response shape unexpected)'
            : 'UNDETERMINED'
  };
}

async function main() {
  const { origin } = parseArgs(process.argv);
  console.log(`OP-016 CORS probe for ${TOKEN_ENDPOINT}`);
  console.log(`Origin under test: ${origin}`);
  console.log('');

  let preflightResult, postResult;
  try {
    preflightResult = await preflight(origin);
  } catch (e) {
    console.error(`OPTIONS preflight failed: ${e.message}`);
    console.error('Cannot determine CORS status; treat as BLOCKED.');
    process.exit(1);
  }
  try {
    postResult = await actualPost(origin);
  } catch (e) {
    console.error(`POST request failed: ${e.message}`);
    console.error('Cannot determine CORS status; treat as BLOCKED.');
    process.exit(1);
  }

  console.log('Preflight (OPTIONS):');
  console.log(`  status: ${preflightResult.status}`);
  console.log(
    `  Access-Control-Allow-Origin: ${preflightResult.allowOrigin ?? '<absent>'}`
  );
  console.log(
    `  Access-Control-Allow-Methods: ${preflightResult.allowMethods ?? '<absent>'}`
  );
  console.log(
    `  Access-Control-Allow-Headers: ${preflightResult.allowHeaders ?? '<absent>'}`
  );
  console.log('');
  console.log('Actual POST (bogus payload):');
  console.log(`  status: ${postResult.status}`);
  console.log(
    `  Access-Control-Allow-Origin: ${postResult.allowOrigin ?? '<absent>'}`
  );
  console.log(`  body keys: ${postResult.bodyShape}`);
  console.log('');

  const classified = classify(preflightResult, postResult, origin);
  console.log('Classification:');
  console.log(`  CORS on POST:      ${classified.corsOnPost}`);
  console.log(`  CORS on preflight: ${classified.corsOnPreflight}`);
  console.log(`  Error shape:       ${classified.hasErrorShape}`);
  console.log(`  Verdict:           ${classified.verdict}`);
  console.log('');

  if (classified.verdict === 'OPEN') {
    console.log('OP-016: token endpoint CORS is OPEN for this origin.');
    console.log('M6a can ship as designed (direct browser-side exchange).');
    process.exit(0);
  } else {
    console.log('OP-016: token endpoint CORS appears BLOCKED or UNDETERMINED.');
    console.log('Trigger DEC-018: Worker fallback decision required.');
    console.log('Re-run with `node scripts/cors-probe-google-token.mjs --origin <other-origin>` to compare.');
    process.exit(1);
  }
}

main();
