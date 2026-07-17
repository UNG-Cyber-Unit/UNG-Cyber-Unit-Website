# Plan: Public/Private Profile Toggle

**Goal:** a toggle on `/profile` that controls whether other logged-in users can
view this user's profile by clicking their username on the `/leaderboard` page.

**Status:** planning only — nothing implemented yet. Resolve **Chunk 0** decisions
before writing code.

---

## Chunk 0 — DECISIONS FIRST (resolve these before building)

- [ ] **Default visibility** for existing + new users — sets the migration `DEFAULT`.
      _Recommendation: private (opt-in), i.e. `DEFAULT 0`._
- [ ] **What a public profile shows.** Proposed: username, avatar, member-since,
      module/room ranks, earned badges, topic-quiz progress. Proposed to EXCLUDE:
      quiz-room history (feels private). _Confirm the exact field list._
- [ ] **URL scheme** for viewing others. _Recommendation: `/u/:username` (short, dynamic)._
- [ ] **Leaderboard link behavior.** _Recommendation: only link **public** usernames
      (needs `is_public` in the leaderboard payload); private ones stay plain text._
      Alternative: link all, show a "private" state when opened.
- [ ] **Toggle UI.** _Recommendation: a switch/pill in the `// Account` section._

---

## Session learnings / project gotchas (READ FIRST)

These bit us this session — keep them in mind for this feature:

- **Deploy pipeline was silently broken.** The GitHub Action was deploying *assets*
  but not the *Worker script* because `cloudflare/wrangler-action@v3` had no
  `command`. Fixed by adding `command: deploy`, pinning wrangler, running `npm test`,
  and a post-deploy smoke check (`.github/workflows/deploy.yml`). **Deploys are gated
  on `npm test`** — keep tests green or nothing ships.
- **Remote D1 migration must run BEFORE the push deploys**, or prod queries a missing
  column and errors:
  `npx wrangler d1 execute DB --local  --command "ALTER TABLE users ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0"`
  then the same with `--remote`.
- **Cloudflare edge-caches HTML aggressively** (responses come back `cf-cache HIT`
  even with `no-store`). Worker-injected pages (`/`, `/start`, topics, view-routes)
  now strip the asset's `Cache-Control` and send `no-store` — keep doing that for any
  new worker-served HTML. After a deploy, a stale page may need a **Caching → Purge
  Everything** in the Cloudflare dashboard. To see *fresh* worker output bypassing the
  zone cache, hit the raw URL: `https://ung-cyber-unit-website.joshuaacklen.workers.dev/...`.
- **Static files bypass the worker.** Any new *static* HTML page must be added to
  `run_worker_first` in `wrangler.toml` to get security headers. **Dynamic paths**
  (`/topic/:id`, `/quiz/:code`, and the new `/u/:username`) already hit the worker, so
  they do NOT need a `run_worker_first` entry.
- **No inline `<script>`.** CSP `script-src` is `'self'` only — all JS lives in
  `public/js/*.js` (e.g. `main.js`). Inline scripts are blocked.
- **noindex** non-content pages (`<meta name="robots" content="noindex">`), like the
  app pages. Public profiles should be noindex too.
- **Canonical domain:** `https://ungcyberunit.org`.
- **Reusable server helpers already exist:** `pathwayBadges(doneSet)` and
  `leaderboardRank(env, table, userId, username)` — use them for the public profile.
- **Test mock DB** (`test/worker.test.mjs`) supports both `.bind().run/first/all` and
  parameterless `.all()/.first()`. Add exports + tests for any new pure helper.
- **Verification pattern:** `npx wrangler dev`, seed via `curl`, drive/screenshot in
  headless Chrome (`puppeteer-core` lives in the scratchpad dir, not the project),
  then delete test users/rows from local D1.
- **SQL-injection guard:** when a table name is chosen by mode (e.g. leaderboard), it
  comes from a fixed lookup, never user input. Keep that pattern.

### Current profile/leaderboard shape (what to build on)
- `/profile`: big green centered **username header** (`#profileName`), then `// Account`
  tiles = Role, Member Since, **Module Rank**, **Room Rank** (Username tile was removed);
  then Pathway Badges, Topic Quiz Progress, Quiz Room History. Own-only controls:
  avatar upload.
- `users` columns today: `id, username, password_hash, role, avatar, streak,
  last_active, created_at`.
- `/api/leaderboard?mode=modules|rooms` → `{ mode, top:[{rank,username,avatar,points,
  count,perfect}], me:{...} }`. Guests excluded from ranking.
- `/api/profile` → `{ id, username, role, avatar, created_at, roomAttempts, badges,
  rank, roomRank }`.

---

## Implementation checklist

### 1. Data model + migration
- [ ] `schema.sql`: `is_public INTEGER NOT NULL DEFAULT <0|1>` on `users`.
- [ ] Migrate local, then **remote before deploy**.

### 2. Server (`worker.js`)
- [ ] `/api/profile`: include the owner's `is_public`.
- [ ] `POST /api/profile/visibility` (or `PATCH /api/profile`): auth required; boolean
      body; updates **only `session.sub`**; returns new value. Guests rejected/no-op.
- [ ] `GET /api/user/:username`: returns the **public subset only** when `is_public=1`;
      else `403` (generic "private"); `404` unknown/guest. Reuse `pathwayBadges` +
      `leaderboardRank`. Never return private fields.
- [ ] `/api/leaderboard`: add `u.is_public` to the query + each `top` row.

### 3. Client — profile page (toggle)
- [ ] Add the toggle to `profile.html` (Account/header) with a clear label.
- [ ] Wire in `main.js`: init from `profile.is_public`, `POST` on change, reflect
      success/failure. No inline script.

### 4. Client — leaderboard (clickable usernames)
- [ ] In `renderLeaderboard`, link the username to `/u/:username` only when
      `row.is_public` (and not guest); else plain text. Keep avatar + "you" layout.
- [ ] Small CSS for the linked username.

### 5. Public profile view (new page)
- [ ] `public/u.html` shell: navbar, container, `noindex`, loads `/js/main.js`.
- [ ] Worker route: match `/u/:username` (dynamic → hits worker like `/quiz/:code`),
      serve the shell. No `run_worker_first` entry (dynamic path).
- [ ] `main.js` dispatch branch `/u/...` → `initPublicProfile()`: parse username,
      fetch `/api/user/:username`, render public subset (reuse green name header,
      avatar, rank tiles, badges, progress). Handle 3 states: rendered / private / 404.
- [ ] Do NOT show owner-only controls (avatar upload, visibility toggle) on others'.

### 6. Security / privacy review (this project cares)
- [ ] Toggle mutates only the caller's row (`WHERE id = session.sub`), no target id.
- [ ] `/api/user/:username`: only whitelisted public fields, only when `is_public=1`;
      private → 403 (no data), unknown/guest → 404. No IDOR, no leakage.
- [ ] `escHtml` others' usernames; avatars stay under CSP `img-src 'self' data:`.

### 7. Tests (`test/worker.test.mjs` — gates deploy)
- [ ] `POST /api/profile/visibility`: requires session.
- [ ] `GET /api/user/:username`: 403 private, 404 unknown, public shape when public
      (mock returns `is_public=1`), no private fields.
- [ ] `/api/leaderboard`: rows include `is_public`.
- [ ] Export + unit-test any new pure helper (e.g. a public-profile projection).

### 8. Docs
- [ ] `README.md`: add `/u/:username`, `/api/user/:username`,
      `/api/profile/visibility`; note `users.is_public` in the schema line.
- [ ] `CLAUDE.md`: note the public/private convention + that `/api/user/:username`
      must never return private fields.

### 9. Deploy
- [ ] Remote migration first → commit + push (auto-deploys) → verify: toggle
      persists, public user viewable at `/u/:name`, private user shows private state,
      leaderboard links only public users. Purge cache if a page looks stale.

---

## Suggested build order (each a shippable chunk)
1. Migration + `is_public` in `/api/profile` + the toggle UI.
2. `GET /api/user/:username` + the `/u/:username` page.
3. Leaderboard link-gating with `is_public`.

**Riskiest part: #6** — the public endpoint must be strict about *which* users and
*which* fields it exposes.
