/* ============================================================
   Unit tests for worker.js helpers + the avatar upload endpoint.
   Run with: npm test   (Node's built-in test runner, no deps)
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import worker, {
  base64ImageMatchesType,
  parseCookies,
  timingSafeEqual,
  hashPassword,
  verifyPassword,
  signJWT,
  verifyJWT,
  generateRoomCode,
  parseCSVLine,
  parseCSV,
  validateJSONQuestions,
} from '../worker.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

// Minimal but valid magic-byte prefixes, base64-encoded, for each accepted type.
const b64 = bytes => btoa(String.fromCharCode(...bytes));
// PNG signature (8 bytes) + 1 trailing byte, so length > 8.
const PNG_B64  = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
// JPEG SOI+marker (FF D8 FF) + 1 byte, so length > 3.
const JPEG_B64 = b64([0xff, 0xd8, 0xff, 0xe0]);
// "RIFF"????"WEBP" + 1 byte, so length > 12.
const WEBP_B64 = btoa('RIFF\x00\x00\x00\x00WEBP\x00');

const VALID_PNG_DATAURL = `data:image/png;base64,${PNG_B64}`;
const SECRET = 'test-secret-value';

// A mock D1 database that records every prepared/bound/executed statement, so a
// test can assert whether a write actually happened (or, importantly, did not).
function mockDB() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind: (...bindings) => ({
          run:   async () => { calls.push({ sql, bindings, op: 'run' });   return { meta: { last_row_id: 1 } }; },
          first: async () => { calls.push({ sql, bindings, op: 'first' }); return null; },
          all:   async () => { calls.push({ sql, bindings, op: 'all' });   return { results: [] }; },
        }),
      };
    },
  };
}

async function sessionCookieFor(user) {
  const token = await signJWT(
    { sub: user.sub, username: user.username, role: user.role, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  return `session=${token}`;
}

// ─── base64ImageMatchesType (avatar upload security control) ────────────────────

describe('base64ImageMatchesType', () => {
  test('should accept a real PNG signature under the png type', () => {
    // Happy path: canonical case the upload endpoint relies on.
    assert.equal(base64ImageMatchesType(PNG_B64, 'png'), true);
  });

  test('should accept a real JPEG signature under the jpeg type', () => {
    // Happy path for the second supported format.
    assert.equal(base64ImageMatchesType(JPEG_B64, 'jpeg'), true);
  });

  test('should accept a real WEBP (RIFF/WEBP) signature under the webp type', () => {
    // Happy path for the format the client actually produces from canvas.
    assert.equal(base64ImageMatchesType(WEBP_B64, 'webp'), true);
  });

  test('should reject HTML/script bytes smuggled under an image/png label', () => {
    // The core attack: content-type confusion that was storable before the fix.
    const htmlB64 = btoa('<script>alert(1)</script>');
    assert.equal(base64ImageMatchesType(htmlB64, 'png'), false);
  });

  test('should reject bytes whose signature does not match the declared type', () => {
    // PNG bytes labeled as jpeg — type/label mismatch must fail closed.
    assert.equal(base64ImageMatchesType(PNG_B64, 'jpeg'), false);
  });

  test('should reject an unknown/unsupported type', () => {
    // Edge case: only png/jpeg/webp are allowed; anything else falls through to false.
    assert.equal(base64ImageMatchesType(PNG_B64, 'gif'), false);
  });

  test('should return false for an empty base64 string', () => {
    // Edge case: empty input decodes to zero bytes — no signature can match.
    assert.equal(base64ImageMatchesType('', 'png'), false);
  });

  test('should return false (not throw) on invalid base64 input', () => {
    // Error handling: atob throws on illegal chars; the function must swallow it.
    assert.equal(base64ImageMatchesType('@@@not base64@@@', 'png'), false);
  });

  test('should reject a PNG signature that is exactly 8 bytes (boundary: needs > 8)', () => {
    // Boundary: the 8-byte signature alone is length 8, and the check is strictly > 8.
    const exactly8 = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(base64ImageMatchesType(exactly8, 'png'), false);
  });

  test('should reject a JPEG marker that is exactly 3 bytes (boundary: needs > 3)', () => {
    // Boundary: FF D8 FF is length 3; the guard requires strictly more.
    const exactly3 = b64([0xff, 0xd8, 0xff]);
    assert.equal(base64ImageMatchesType(exactly3, 'jpeg'), false);
  });

  test('should reject a WEBP container that is exactly 12 bytes (boundary: needs > 12)', () => {
    // Boundary: "RIFF"+4+"WEBP" is exactly 12 bytes; needs a 13th to pass.
    const exactly12 = btoa('RIFF\x00\x00\x00\x00WEBP');
    assert.equal(base64ImageMatchesType(exactly12, 'webp'), false);
  });
});

// ─── parseCookies ───────────────────────────────────────────────────────────────

describe('parseCookies', () => {
  test('should parse multiple cookies into a key/value map', () => {
    // Happy path.
    assert.deepEqual(parseCookies('session=abc; theme=dark'), { session: 'abc', theme: 'dark' });
  });

  test('should return an empty object for an empty or missing header', () => {
    // Edge case: logged-out requests send no Cookie header.
    assert.deepEqual(parseCookies(''), {});
    assert.deepEqual(parseCookies(undefined), {});
  });

  test('should preserve "=" characters inside a cookie value (e.g. base64/JWT)', () => {
    // Edge case: JWTs contain "=" padding; splitting must not truncate the value.
    assert.deepEqual(parseCookies('session=a=b=c'), { session: 'a=b=c' });
  });

  test('should trim surrounding whitespace from names and values', () => {
    // Edge case: servers may emit "; " separators with padding.
    assert.deepEqual(parseCookies('  a = 1 ;  b = 2 '), { a: '1', b: '2' });
  });
});

// ─── timingSafeEqual ────────────────────────────────────────────────────────────

describe('timingSafeEqual', () => {
  test('should return true for identical strings', () => {
    // Happy path.
    assert.equal(timingSafeEqual('deadbeef', 'deadbeef'), true);
  });

  test('should return false for strings of different length', () => {
    // Boundary: unequal length short-circuits before comparison.
    assert.equal(timingSafeEqual('abc', 'abcd'), false);
  });

  test('should return false for same-length differing strings', () => {
    // Core case: one differing char must fail.
    assert.equal(timingSafeEqual('abcd', 'abce'), false);
  });

  test('should return true for two empty strings', () => {
    // Edge case: empty inputs are equal.
    assert.equal(timingSafeEqual('', ''), true);
  });
});

// ─── hashPassword / verifyPassword (PBKDF2 side effects via WebCrypto) ───────────

describe('password hashing', () => {
  test('should verify a password against its own hash', async () => {
    // Happy path: round-trip must succeed.
    const hash = await hashPassword('correct horse battery staple');
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  });

  test('should reject an incorrect password', async () => {
    // Core security case: wrong password must not verify.
    const hash = await hashPassword('hunter2hunter2');
    assert.equal(await verifyPassword('wrong-password', hash), false);
  });

  test('should produce a "salt:hash" hex-encoded string', async () => {
    // Structure check: downstream split(":") depends on this shape.
    const hash = await hashPassword('anything123');
    assert.match(hash, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  test('should use a random salt so identical passwords hash differently', async () => {
    // Side effect: crypto.getRandomValues salt means no two hashes collide.
    const a = await hashPassword('samepass');
    const b = await hashPassword('samepass');
    assert.notEqual(a, b);
  });
});

// ─── signJWT / verifyJWT ────────────────────────────────────────────────────────

describe('JWT sign/verify', () => {
  test('should round-trip a payload through sign then verify', async () => {
    // Happy path.
    const token = await signJWT({ sub: 7, role: 'admin' }, SECRET);
    const payload = await verifyJWT(token, SECRET);
    assert.equal(payload.sub, 7);
    assert.equal(payload.role, 'admin');
  });

  test('should return null when verified with the wrong secret', async () => {
    // Security: a token signed elsewhere must not validate.
    const token = await signJWT({ sub: 1 }, SECRET);
    assert.equal(await verifyJWT(token, 'a-different-secret'), null);
  });

  test('should return null for a tampered signature', async () => {
    // Security: flipping the payload without re-signing must fail.
    const token = await signJWT({ sub: 1, role: 'member' }, SECRET);
    const [h, , s] = token.split('.');
    const forgedBody = btoa(JSON.stringify({ sub: 1, role: 'admin' })).replace(/=/g, '');
    assert.equal(await verifyJWT(`${h}.${forgedBody}.${s}`, SECRET), null);
  });

  test('should return null for an expired token', async () => {
    // Boundary: exp one second in the past must be rejected.
    const token = await signJWT({ sub: 1, exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
    assert.equal(await verifyJWT(token, SECRET), null);
  });

  test('should return null for a malformed token (not three parts)', async () => {
    // Error handling: garbage input must not throw.
    assert.equal(await verifyJWT('not-a-jwt', SECRET), null);
  });
});

// ─── generateRoomCode ───────────────────────────────────────────────────────────

describe('generateRoomCode', () => {
  test('should match the XXXX-XXXX format with an allowed charset', () => {
    // Happy path + format contract used by the route matcher.
    assert.match(generateRoomCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  });

  test('should never contain visually ambiguous characters (I, O, 0, 1)', () => {
    // Edge case: the alphabet deliberately omits look-alikes to avoid typos.
    for (let i = 0; i < 200; i++) {
      assert.doesNotMatch(generateRoomCode(), /[IO01]/);
    }
  });
});

// ─── parseCSVLine ───────────────────────────────────────────────────────────────

describe('parseCSVLine', () => {
  test('should split a simple comma-separated line', () => {
    // Happy path.
    assert.deepEqual(parseCSVLine('a,b,c'), ['a', 'b', 'c']);
  });

  test('should keep commas that are inside quoted fields', () => {
    // Core CSV rule: quotes protect embedded delimiters.
    assert.deepEqual(parseCSVLine('"a,b",c'), ['a,b', 'c']);
  });

  test('should unescape doubled quotes inside a quoted field', () => {
    // Edge case: "" is the CSV escape for a literal quote.
    assert.deepEqual(parseCSVLine('"say ""hi""",x'), ['say "hi"', 'x']);
  });

  test('should return a single empty field for an empty line', () => {
    // Edge case: empty input still yields one (empty) column.
    assert.deepEqual(parseCSVLine(''), ['']);
  });
});

// ─── parseCSV ───────────────────────────────────────────────────────────────────

describe('parseCSV', () => {
  test('should parse a header plus one multiple-choice question', () => {
    // Happy path.
    const csv = 'question,answer_a,answer_b,correct\nWhat is 2+2?,3,4,1';
    const result = parseCSV(csv);
    assert.equal(result.error, undefined);
    assert.equal(result.questions.length, 1);
    assert.deepEqual(result.questions[0].answers, ['3', '4']);
    assert.equal(result.questions[0].correct, 1);
  });

  test('should parse a free_response row with no answers', () => {
    // Branch: free_response skips answer/correct validation.
    const csv = 'question,type\nExplain TLS.,free_response';
    const result = parseCSV(csv);
    assert.equal(result.questions[0].type, 'free_response');
    assert.deepEqual(result.questions[0].answers, []);
    assert.equal(result.questions[0].correct, null);
  });

  test('should error when only a header row is present', () => {
    // Edge case: no questions means nothing to import.
    assert.match(parseCSV('question,answer_a').error, /header row and at least one/);
  });

  test('should error when the required "question" column is missing', () => {
    // Error handling: the schema requires a question column.
    assert.match(parseCSV('foo,bar\n1,2').error, /Missing required CSV column/);
  });

  test('should error when a multiple-choice row has fewer than 2 answers', () => {
    // Boundary: MC questions need at least two options.
    assert.match(parseCSV('question,answer_a,correct\nQ,only,0').error, /at least 2 non-empty/);
  });

  test('should error when "correct" is out of range', () => {
    // Boundary: correct index must be within the answers array.
    assert.match(parseCSV('question,answer_a,answer_b,correct\nQ,a,b,5').error, /"correct" must be 0/);
  });

  test('should error when more than 100 questions are supplied', () => {
    // Large input: the 100-question cap must reject 101 rows.
    const rows = Array.from({ length: 101 }, (_, i) => `Q${i},a,b,0`).join('\n');
    assert.match(parseCSV(`question,answer_a,answer_b,correct\n${rows}`).error, /Maximum 100/);
  });
});

// ─── validateJSONQuestions ──────────────────────────────────────────────────────

describe('validateJSONQuestions', () => {
  test('should accept a well-formed question array', () => {
    // Happy path.
    const result = validateJSONQuestions([
      { question: 'Q1', answers: ['a', 'b'], correct: 0 },
    ]);
    assert.equal(result.error, undefined);
    assert.equal(result.questions.length, 1);
  });

  test('should error when input is not an array', () => {
    // Error handling: a bare object / string is invalid.
    assert.match(validateJSONQuestions({ question: 'x' }).error, /must be an array/);
  });

  test('should error on an empty array', () => {
    // Edge case: at least one question is required.
    assert.match(validateJSONQuestions([]).error, /At least one question/);
  });

  test('should error when question text is missing or blank', () => {
    // Error handling: whitespace-only text is treated as missing.
    assert.match(validateJSONQuestions([{ question: '   ', answers: ['a', 'b'], correct: 0 }]).error, /question text is required/);
  });

  test('should error when a multiple-choice question has too many answers', () => {
    // Boundary: 2–4 answers only; 5 must fail.
    assert.match(validateJSONQuestions([{ question: 'Q', answers: ['a', 'b', 'c', 'd', 'e'], correct: 0 }]).error, /must have 2–4 answers/);
  });

  test('should error when correct index is out of range', () => {
    // Boundary: correct must point at an existing answer.
    assert.match(validateJSONQuestions([{ question: 'Q', answers: ['a', 'b'], correct: 2 }]).error, /correct must be 0/);
  });

  test('should error when more than 100 questions are supplied', () => {
    // Large input: enforce the same 100-question cap as CSV.
    const many = Array.from({ length: 101 }, (_, i) => ({ question: `Q${i}`, answers: ['a', 'b'], correct: 0 }));
    assert.match(validateJSONQuestions(many).error, /Maximum 100/);
  });
});

// ─── Endpoint: POST /api/profile/avatar (side effects via mocked D1) ─────────────

describe('POST /api/profile/avatar', () => {
  const makeReq = (avatar, cookie) => new Request('https://example.com/api/profile/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ avatar }),
  });

  test('should store a valid image and write it to the database', async () => {
    // Happy path + side effect: a real PNG must reach an UPDATE on the DB.
    const db = mockDB();
    const cookie = await sessionCookieFor({ sub: 42, username: 'alice', role: 'member' });
    const res = await worker.fetch(makeReq(VALID_PNG_DATAURL, cookie), { JWT_SECRET: SECRET, DB: db });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.avatar, VALID_PNG_DATAURL);
    // The write must have happened, bound to this user's id.
    const write = db.calls.find(c => c.op === 'run' && /UPDATE users SET avatar/.test(c.sql));
    assert.ok(write, 'expected an UPDATE users SET avatar write');
    assert.deepEqual(write.bindings, [VALID_PNG_DATAURL, 42]);
  });

  test('should reject non-image content mislabeled as image/png without touching the DB', async () => {
    // Security + side-effect absence: rejected uploads must not write anything.
    const db = mockDB();
    const cookie = await sessionCookieFor({ sub: 42, username: 'alice', role: 'member' });
    const payload = `data:image/png;base64,${btoa('<script>alert(1)</script>')}`;
    const res = await worker.fetch(makeReq(payload, cookie), { JWT_SECRET: SECRET, DB: db });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /not a valid image/);
    assert.equal(db.calls.length, 0, 'no DB writes should occur on rejection');
  });

  test('should reject an oversized payload (> 150000 chars) without touching the DB', async () => {
    // Boundary + DoS guard: length cap must trip before any decode/DB work.
    const db = mockDB();
    const cookie = await sessionCookieFor({ sub: 42, username: 'alice', role: 'member' });
    const huge = `data:image/png;base64,${'A'.repeat(150_001)}`;
    const res = await worker.fetch(makeReq(huge, cookie), { JWT_SECRET: SECRET, DB: db });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /too large/i);
    assert.equal(db.calls.length, 0);
  });

  test('should reject a non-string avatar value', async () => {
    // Error handling: a numeric/array avatar must be refused, not coerced.
    const db = mockDB();
    const cookie = await sessionCookieFor({ sub: 42, username: 'alice', role: 'member' });
    const res = await worker.fetch(makeReq(12345, cookie), { JWT_SECRET: SECRET, DB: db });

    assert.equal(res.status, 400);
    assert.equal(db.calls.length, 0);
  });

  test('should reject an unauthenticated request with 401', async () => {
    // Access control: no session cookie means no upload.
    const db = mockDB();
    const res = await worker.fetch(makeReq(VALID_PNG_DATAURL, undefined), { JWT_SECRET: SECRET, DB: db });

    assert.equal(res.status, 401);
    assert.equal(db.calls.length, 0);
  });
});
