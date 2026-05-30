/**
 * Minimal Google Drive REST client for the `drive.appdata` scope
 * (M6a code).
 *
 * # Why this is a thin wrapper rather than a full client
 *
 * Quire's cloud-sync surface area is intentionally small:
 *
 *   - One file per campaign in the `appDataFolder` space.
 *   - File body is the same `SaveDocument` JSON the runtime
 *     produces today (`stringifySave`).
 *   - Operations: upload (create / update), download, list.
 *
 * That fits within the Drive REST v3 endpoints
 * `/upload/drive/v3/files` (create) + `/drive/v3/files/<id>`
 * (update / read) + `/drive/v3/files?q=<query>&spaces=appDataFolder`
 * (list).  We deliberately AVOID importing the heavyweight Google
 * client library — the dependency surface, tree-shake-ability,
 * and supply-chain footprint would be disproportionate for the
 * three operations we need.
 *
 * # The `drive.appdata` scope (DEC-009)
 *
 * Per DEC-009, the M6a scope is exclusively `drive.appdata` — the
 * per-app hidden folder.  Files in `appDataFolder` are:
 *
 *   - Invisible in the user's Drive UI.
 *   - Not shareable (DEC-009 closes the ADV-1 share-link leak).
 *   - Owned by the user (recoverable from Google Takeout?  NO —
 *     OP-031 documents the structural irrecoverability on account
 *     death).
 *   - Accessible ONLY to the app that created them.
 *
 * NEVER request `drive.file` or the whole-Drive scope in M6a.
 *
 * # Error semantics
 *
 * The functions return typed results, not throwing past the
 * outermost `fetch` boundary.  401 in particular maps to a
 * dedicated `'unauthorized'` reason so the caller can surface
 * the §A12 row 4 + §A9.1 "re-connect Drive" chip per OP-022.
 *
 * The functions do NOT touch the OAuth flow — they consume a
 * pre-acquired ephemeral `accessToken` and return on failure.
 * That keeps this module pure (no popup, no session storage)
 * and lets `cloud-push.ts` orchestrate auth + Drive calls.
 *
 * # No PII in logged error paths
 *
 * Per OP-030 / DEC-023 class 1, the Drive API may return error
 * bodies with PII (e.g. the user's email in
 * `error.errors[].message`).  The error-shaped results return
 * only the Google `error.code` enum (a small fixed vocabulary);
 * callers MUST NOT log the raw response body.
 */

// ---------------------------------------------------------------
// Public types
// ---------------------------------------------------------------

/**
 * Pluggable `fetch` so tests can substitute canned Responses.
 */
export type DriveFetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

/**
 * The shape callers receive on a successful upload.
 */
export interface UploadAppdataSuccess {
  readonly ok: true;
  /**
   * Drive's stable file identifier.  Caller persists in the
   * campaign manifest (per the M6a roadmap DoD) so subsequent
   * push/pull can target the same file.
   */
  readonly fileId: string;
  /**
   * Drive's `headRevisionId` — the optimistic-concurrency token.
   * Caller uses it on subsequent updates via `If-Match` to defend
   * against the multi-DM concurrent push race (DEC-016 / OP-011
   * pull-rebase-push).
   */
  readonly headRevisionId: string;
  /**
   * The `name` field Drive accepted.  Echoed back for the
   * caller's audit trail.
   */
  readonly name: string;
  /**
   * `modifiedTime` ISO-8601 string from Drive.  Used by §A11
   * pull-on-discovery's "Your Drive has a backup from N days ago"
   * surface.
   */
  readonly modifiedTime: string;
}

/**
 * Failure reasons.  Each maps to one of the §A12 error-matrix
 * rows OR to a non-user-visible internal failure that callers
 * surface as the generic network-failure copy.
 */
export type DriveApiFailureReason =
  | 'unauthorized' // 401 — token expired or revoked (OP-022)
  | 'forbidden' // 403 — scope mismatch, APP-blocked, rate-limited
  | 'not-found' // 404 — file id no longer valid
  | 'precondition-failed' // 412 — If-Match mismatch (pull-rebase-push)
  | 'network-failure' // fetch rejected / 5xx
  | 'malformed-response' // 200 but no fileId in body
  | 'quota-exceeded'; // 403 with reason userRateLimitExceeded / quotaExceeded

export interface DriveApiFailure {
  readonly ok: false;
  readonly reason: DriveApiFailureReason;
  /**
   * Drive's `error.code` enum value when available.  Always a
   * Google-defined string from a small fixed vocabulary;
   * SAFE to log.
   */
  readonly errorCode?: string;
}

export type UploadAppdataResult = UploadAppdataSuccess | DriveApiFailure;

export interface UploadAppdataArgs {
  readonly accessToken: string;
  /**
   * File name within the appDataFolder space.  Convention:
   * `quire-<campaignSlug>.json`.  Drive permits multiple files
   * with the same name; the caller is responsible for not
   * creating duplicates (i.e. pass `fileId` to update an
   * existing one).
   */
  readonly fileName: string;
  /**
   * The body string to upload — the runtime's `stringifySave`
   * output (deterministic JSON).
   */
  readonly body: string;
  /**
   * Optional existing Drive file id.  Provided → PATCH update of
   * that file.  Absent → create a new file in appDataFolder.
   */
  readonly fileId?: string;
  /**
   * Optional `If-Match: <revisionId>` for optimistic concurrency
   * on update.  Only meaningful when `fileId` is provided.  The
   * caller passes the `headRevisionId` from the last
   * upload/download.  If the file has been modified on the
   * server since, Drive returns 412 → caller pulls-rebases-pushes.
   */
  readonly ifMatchRevisionId?: string;
}

/**
 * Drive REST endpoints used by this module.  Centralized so a
 * future test can intercept them without grepping for strings.
 */
const DRIVE_UPLOAD_CREATE =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=false';
const DRIVE_UPLOAD_UPDATE = (id: string) =>
  `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=multipart&supportsAllDrives=false`;

/**
 * Multipart-related boundary used in the upload body.  A fixed
 * UUID-shaped string — Drive accepts any boundary so a constant
 * works.  Per RFC 2046 it must not appear in the body; we use a
 * boundary with non-base64url characters specifically so
 * deterministic Drive payloads can't collide.
 */
const MULTIPART_BOUNDARY = '----quire-drive-appdata-boundary----';

/**
 * Map an HTTP response to a typed failure (or null if not a
 * recognized failure — the caller treats null as success and
 * parses the body itself).
 */
async function mapErrorResponse(
  resp: Response
): Promise<DriveApiFailure | null> {
  if (resp.ok) return null;
  let errorCode: string | undefined;
  let errorReasonHint: string | undefined;
  try {
    const body = (await resp.clone().json()) as {
      error?: { code?: unknown; status?: unknown; errors?: unknown };
    };
    if (typeof body.error?.code === 'number') {
      errorCode = String(body.error.code);
    } else if (typeof body.error?.code === 'string') {
      errorCode = body.error.code;
    }
    if (typeof body.error?.status === 'string') {
      errorReasonHint = body.error.status;
    }
    // Some Drive errors carry a more specific `errors[].reason`
    // we can pluck for the quota-exceeded path.
    if (Array.isArray(body.error?.errors) && body.error!.errors!.length > 0) {
      const first = (body.error!.errors as Array<{ reason?: unknown }>)[0];
      if (first && typeof first.reason === 'string') {
        errorReasonHint = first.reason;
      }
    }
  } catch {
    // Non-JSON body — leave errorCode undefined.
  }

  if (resp.status === 401) {
    return { ok: false, reason: 'unauthorized', errorCode };
  }
  if (resp.status === 403) {
    if (
      errorReasonHint === 'userRateLimitExceeded' ||
      errorReasonHint === 'rateLimitExceeded' ||
      errorReasonHint === 'quotaExceeded'
    ) {
      return { ok: false, reason: 'quota-exceeded', errorCode };
    }
    return { ok: false, reason: 'forbidden', errorCode };
  }
  if (resp.status === 404) {
    return { ok: false, reason: 'not-found', errorCode };
  }
  if (resp.status === 412) {
    return { ok: false, reason: 'precondition-failed', errorCode };
  }
  return { ok: false, reason: 'network-failure', errorCode };
}

/**
 * Compose the multipart/related body Drive's multipart upload
 * expects.  Two parts:
 *
 *   1. metadata JSON describing the file (name + parents +
 *      mimeType).
 *   2. the body content (application/json).
 *
 * The metadata part's `parents: ['appDataFolder']` is what tells
 * Drive to place the file in the per-app hidden folder.
 */
function buildMultipartBody(
  metadata: Record<string, unknown>,
  bodyJson: string
): { contentType: string; body: string } {
  const lines = [
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${MULTIPART_BOUNDARY}`,
    'Content-Type: application/json',
    '',
    bodyJson,
    `--${MULTIPART_BOUNDARY}--`,
    ''
  ];
  return {
    contentType: `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
    body: lines.join('\r\n')
  };
}

/**
 * Upload (or update) a file in the user's `drive.appdata` space.
 *
 * Create vs. update is keyed on whether `fileId` was passed:
 *
 *   - `fileId` absent → POST to the create endpoint with
 *     `parents: ['appDataFolder']` in metadata.
 *   - `fileId` present → PATCH to the update endpoint with the
 *     id in the URL.  Optionally pass `If-Match: <revisionId>`
 *     for optimistic concurrency.
 *
 * Returns either `{ ok: true, fileId, headRevisionId, ... }` on
 * success or a typed `{ ok: false, reason }` on each documented
 * failure path.  Never throws past the outermost `fetch`.
 *
 * The `fetchImpl` parameter is mandatory (no default) so callers
 * are explicit about which `fetch` they're using.  In production
 * `cloud-push.ts` passes `globalThis.fetch`; tests pass a stub.
 */
export async function uploadAppdata(
  args: UploadAppdataArgs,
  fetchImpl: DriveFetchLike
): Promise<UploadAppdataResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`
  };

  const isUpdate = typeof args.fileId === 'string' && args.fileId.length > 0;
  const metadata: Record<string, unknown> = {
    name: args.fileName,
    mimeType: 'application/json'
  };
  if (!isUpdate) {
    // Create — must specify the appDataFolder parent.  On
    // update, Drive refuses parent changes for appDataFolder
    // files anyway; omitting `parents` keeps the existing
    // placement.
    metadata.parents = ['appDataFolder'];
  }

  const { contentType, body } = buildMultipartBody(metadata, args.body);
  headers['Content-Type'] = contentType;

  if (isUpdate && args.ifMatchRevisionId) {
    headers['If-Match'] = args.ifMatchRevisionId;
  }

  const url = isUpdate
    ? DRIVE_UPLOAD_UPDATE(args.fileId!) + '&fields=id,name,headRevisionId,modifiedTime'
    : DRIVE_UPLOAD_CREATE + '&fields=id,name,headRevisionId,modifiedTime';

  let resp: Response;
  try {
    resp = await fetchImpl(url, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers,
      body
    });
  } catch {
    return { ok: false, reason: 'network-failure' };
  }

  const errorResult = await mapErrorResponse(resp);
  if (errorResult) return errorResult;

  let parsed: unknown;
  try {
    parsed = await resp.json();
  } catch {
    return { ok: false, reason: 'malformed-response' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'malformed-response' };
  }
  const p = parsed as {
    id?: unknown;
    name?: unknown;
    headRevisionId?: unknown;
    modifiedTime?: unknown;
  };
  if (
    typeof p.id !== 'string' ||
    p.id.length === 0 ||
    typeof p.name !== 'string' ||
    typeof p.headRevisionId !== 'string' ||
    typeof p.modifiedTime !== 'string'
  ) {
    return { ok: false, reason: 'malformed-response' };
  }
  return {
    ok: true,
    fileId: p.id,
    name: p.name,
    headRevisionId: p.headRevisionId,
    modifiedTime: p.modifiedTime
  };
}

// ---------------------------------------------------------------
// Test helpers exported for cross-module callers.
// ---------------------------------------------------------------

/**
 * Exposed for tests + for a future `cloud-push.ts` retry layer
 * that wants to detect retryable failures.
 */
export function isRetryable(reason: DriveApiFailureReason): boolean {
  return reason === 'network-failure' || reason === 'quota-exceeded';
}
