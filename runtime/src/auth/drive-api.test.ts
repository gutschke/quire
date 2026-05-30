/**
 * Drive REST client tests (M6a code).
 *
 * Covers `uploadAppdata` against:
 *
 *   - Happy create (POST → 200 with fileId/headRevisionId).
 *   - Happy update (PATCH → 200 echoing updated metadata).
 *   - `If-Match` header propagation on update.
 *   - 401 → unauthorized (OP-022 / §A12 row 4 routing).
 *   - 403 with quotaExceeded reason → quota-exceeded.
 *   - 403 plain → forbidden.
 *   - 404 → not-found.
 *   - 412 → precondition-failed (pull-rebase-push case).
 *   - 5xx → network-failure.
 *   - Fetch reject → network-failure.
 *   - 200 with bad body → malformed-response.
 *   - Authorization header always Bearer.
 *   - Multipart body contains the file body verbatim + appDataFolder parent on create.
 *   - parents NOT in metadata on update (Drive refuses parent changes).
 *
 * Plus the small `isRetryable` predicate.
 */

import { describe, expect, it } from 'vitest';
import {
  isRetryable,
  uploadAppdata,
  type DriveFetchLike,
  type UploadAppdataArgs
} from './drive-api';

/**
 * Build a stub `fetch` that records call args + replies with the
 * provided response init.
 */
function stubFetch(
  next:
    | { status: number; jsonBody: unknown }
    | { status: number; bodyText: string }
    | { reject: Error }
): DriveFetchLike & {
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = async (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });
    if ('reject' in next) throw next.reject;
    if ('jsonBody' in next) {
      return new Response(JSON.stringify(next.jsonBody), {
        status: next.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(next.bodyText, { status: next.status });
  };
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn as DriveFetchLike & { calls: typeof calls };
}

const BASE_ARGS: UploadAppdataArgs = {
  accessToken: 'ya29.test',
  fileName: 'quire-owner-repo.json',
  body: '{"hello":"world"}'
};

describe('uploadAppdata — happy path create', () => {
  it('POSTs to the create endpoint and returns the Drive metadata', async () => {
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        id: 'file-abc',
        name: 'quire-owner-repo.json',
        headRevisionId: 'rev-1',
        modifiedTime: '2026-05-29T12:00:00.000Z'
      }
    });
    const result = await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileId).toBe('file-abc');
      expect(result.headRevisionId).toBe('rev-1');
      expect(result.name).toBe('quire-owner-repo.json');
      expect(result.modifiedTime).toBe('2026-05-29T12:00:00.000Z');
    }
    expect(fetchImpl.calls.length).toBe(1);
    const call = fetchImpl.calls[0]!;
    expect(call.url).toContain(
      'https://www.googleapis.com/upload/drive/v3/files'
    );
    expect(call.url).toContain('uploadType=multipart');
    expect(call.init?.method).toBe('POST');
  });

  it('Authorization header is Bearer <accessToken>', async () => {
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        id: 'file-abc',
        name: 'x',
        headRevisionId: 'rev-1',
        modifiedTime: '2026-05-29T12:00:00.000Z'
      }
    });
    await uploadAppdata(BASE_ARGS, fetchImpl);
    const headers = fetchImpl.calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ya29.test');
  });

  it('multipart body contains the file body + appDataFolder parent', async () => {
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        id: 'f',
        name: 'x',
        headRevisionId: 'r',
        modifiedTime: '2026-05-29T12:00:00.000Z'
      }
    });
    await uploadAppdata(BASE_ARGS, fetchImpl);
    const body = fetchImpl.calls[0]!.init?.body as string;
    expect(body).toContain('appDataFolder');
    expect(body).toContain('"hello":"world"');
    expect(body).toContain('quire-owner-repo.json');
  });
});

describe('uploadAppdata — happy path update', () => {
  it('PATCHes to the update endpoint when fileId is provided', async () => {
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        id: 'file-abc',
        name: 'quire-owner-repo.json',
        headRevisionId: 'rev-2',
        modifiedTime: '2026-05-29T13:00:00.000Z'
      }
    });
    const result = await uploadAppdata(
      { ...BASE_ARGS, fileId: 'file-abc' },
      fetchImpl
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileId).toBe('file-abc');
      expect(result.headRevisionId).toBe('rev-2');
    }
    const call = fetchImpl.calls[0]!;
    expect(call.url).toContain(
      'https://www.googleapis.com/upload/drive/v3/files/file-abc'
    );
    expect(call.init?.method).toBe('PATCH');
  });

  it('omits appDataFolder parent from metadata on update', async () => {
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        id: 'f',
        name: 'x',
        headRevisionId: 'r',
        modifiedTime: 't'
      }
    });
    await uploadAppdata(
      { ...BASE_ARGS, fileId: 'file-abc' },
      fetchImpl
    );
    const body = fetchImpl.calls[0]!.init?.body as string;
    // The metadata segment lives before the `appDataFolder` would
    // appear; we check the JSON metadata doesn't carry parents.
    expect(body).not.toContain('"parents":["appDataFolder"]');
  });

  it('passes If-Match: <revisionId> when ifMatchRevisionId provided', async () => {
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        id: 'f',
        name: 'x',
        headRevisionId: 'r',
        modifiedTime: 't'
      }
    });
    await uploadAppdata(
      {
        ...BASE_ARGS,
        fileId: 'file-abc',
        ifMatchRevisionId: 'rev-prev'
      },
      fetchImpl
    );
    const headers = fetchImpl.calls[0]!.init?.headers as Record<string, string>;
    expect(headers['If-Match']).toBe('rev-prev');
  });
});

describe('uploadAppdata — failure responses', () => {
  it('401 → unauthorized', async () => {
    const fetchImpl = stubFetch({
      status: 401,
      jsonBody: {
        error: { code: 401, status: 'UNAUTHENTICATED', message: 'expired' }
      }
    });
    const result = await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unauthorized');
  });

  it('403 quotaExceeded → quota-exceeded', async () => {
    const fetchImpl = stubFetch({
      status: 403,
      jsonBody: {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          errors: [
            {
              reason: 'quotaExceeded',
              message: 'Daily quota exceeded'
            }
          ]
        }
      }
    });
    const result = await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('quota-exceeded');
  });

  it('403 plain → forbidden', async () => {
    const fetchImpl = stubFetch({
      status: 403,
      jsonBody: {
        error: { code: 403, status: 'PERMISSION_DENIED' }
      }
    });
    const result = await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden');
  });

  it('404 → not-found', async () => {
    const fetchImpl = stubFetch({
      status: 404,
      jsonBody: { error: { code: 404 } }
    });
    const result = await uploadAppdata(
      { ...BASE_ARGS, fileId: 'gone' },
      fetchImpl
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('412 → precondition-failed (pull-rebase-push)', async () => {
    const fetchImpl = stubFetch({
      status: 412,
      jsonBody: { error: { code: 412 } }
    });
    const result = await uploadAppdata(
      { ...BASE_ARGS, fileId: 'f', ifMatchRevisionId: 'rev-stale' },
      fetchImpl
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('precondition-failed');
  });

  it('5xx → network-failure', async () => {
    const fetchImpl = stubFetch({
      status: 503,
      jsonBody: { error: { code: 503 } }
    });
    const result = await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('network-failure');
  });

  it('fetch reject → network-failure', async () => {
    const fetchImpl = stubFetch({ reject: new Error('offline') });
    const result = await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('network-failure');
  });

  it('200 with missing id → malformed-response', async () => {
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: { name: 'x', headRevisionId: 'r', modifiedTime: 't' }
    });
    const result = await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed-response');
  });

  it('200 with non-JSON body → malformed-response', async () => {
    const fetchImpl = stubFetch({ status: 200, bodyText: 'not-json' });
    const result = await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed-response');
  });

  it('does NOT log Drive error message in the typed result', async () => {
    // OP-030: Drive error messages can carry PII.  Our typed
    // failure only carries the errorCode enum.
    const fetchImpl = stubFetch({
      status: 401,
      jsonBody: {
        error: {
          code: 401,
          status: 'UNAUTHENTICATED',
          message: 'leak@example.com expired token'
        }
      }
    });
    const result = await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result)).not.toContain('leak@example.com');
    }
  });
});

describe('uploadAppdata — request shape invariants', () => {
  it('Content-Type is multipart/related with our boundary', async () => {
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        id: 'f',
        name: 'x',
        headRevisionId: 'r',
        modifiedTime: 't'
      }
    });
    await uploadAppdata(BASE_ARGS, fetchImpl);
    const headers = fetchImpl.calls[0]!.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
  });

  it('url includes fields selector for the response shape', async () => {
    const fetchImpl = stubFetch({
      status: 200,
      jsonBody: {
        id: 'f',
        name: 'x',
        headRevisionId: 'r',
        modifiedTime: 't'
      }
    });
    await uploadAppdata(BASE_ARGS, fetchImpl);
    expect(fetchImpl.calls[0]!.url).toContain(
      'fields=id,name,headRevisionId,modifiedTime'
    );
  });
});

describe('isRetryable predicate', () => {
  it('true for network + quota', () => {
    expect(isRetryable('network-failure')).toBe(true);
    expect(isRetryable('quota-exceeded')).toBe(true);
  });
  it('false for unauthorized, forbidden, not-found, precondition, malformed', () => {
    expect(isRetryable('unauthorized')).toBe(false);
    expect(isRetryable('forbidden')).toBe(false);
    expect(isRetryable('not-found')).toBe(false);
    expect(isRetryable('precondition-failed')).toBe(false);
    expect(isRetryable('malformed-response')).toBe(false);
  });
});
