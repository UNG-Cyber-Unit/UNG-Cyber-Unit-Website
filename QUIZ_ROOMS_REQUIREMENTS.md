# Quiz Rooms — Requirements

## Overview

A "Quiz Room" feature that allows instructors to upload custom question sets,
share a room code with students, and view per-student results after completion.
Intended use: Cyber Unit promotion boards and unit-specific training challenges.

---

## Phase 1 — Role System

### 1.1 Database
- Add `role` column to `users` table: `TEXT NOT NULL DEFAULT 'member'`
- Valid values: `member`, `instructor`, `admin`
- Migration: `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'`

### 1.2 Auth API
- `GET /api/me` response must include `role`
- `currentUser` object in frontend JS must expose `role`
- Worker middleware helper: `requireRole(request, env, minRole)` — returns 403
  if user's role is below the required level (`member < instructor < admin`)

### 1.3 Admin promotion
- `PATCH /api/admin/users/:id` — set role (admin only)
- No UI needed yet; first promotions done via direct D1 query in Wrangler dashboard

---

## Phase 2 — Database Schema

New tables to add to `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS quiz_rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    UNIQUE NOT NULL,       -- e.g. "CYBER-7K2"
  title       TEXT    NOT NULL,
  created_by  INTEGER NOT NULL,              -- users.id
  expires_at  INTEGER,                       -- unix timestamp, NULL = no expiry
  -- one attempt per student per room, enforced at API level
  status      TEXT    NOT NULL DEFAULT 'open', -- 'open' | 'closed'
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS quiz_room_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  question    TEXT    NOT NULL,
  answers     TEXT    NOT NULL,              -- JSON array of strings
  correct     INTEGER NOT NULL,             -- 0-indexed
  explanation TEXT    NOT NULL DEFAULT '',
  FOREIGN KEY (room_id) REFERENCES quiz_rooms(id)
);

CREATE TABLE IF NOT EXISTS quiz_room_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id      INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  score        INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  FOREIGN KEY (room_id)  REFERENCES quiz_rooms(id),
  FOREIGN KEY (user_id)  REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS quiz_room_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id   INTEGER NOT NULL,
  question_id  INTEGER NOT NULL,
  selected     INTEGER NOT NULL,            -- 0-indexed answer chosen
  is_correct   INTEGER NOT NULL,            -- 0 or 1
  FOREIGN KEY (attempt_id)  REFERENCES quiz_room_attempts(id),
  FOREIGN KEY (question_id) REFERENCES quiz_room_questions(id)
);
```

---

## Phase 3 — Instructor Panel (Backend)

### Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `POST` | `/api/rooms` | instructor+ | Create room, parse upload, return code |
| `GET` | `/api/rooms` | instructor+ | List rooms created by this user |
| `GET` | `/api/rooms/:code` | instructor+ | Room detail + full question list |
| `PATCH` | `/api/rooms/:code` | instructor+ | Update status (open/closed), expiry |
| `DELETE` | `/api/rooms/:code` | instructor+ | Delete room and all associated data |
| `GET` | `/api/rooms/:code/results` | instructor+ | All attempts + per-question breakdown |

### Upload parsing (`POST /api/rooms`)

Accepts `multipart/form-data` with:
- `title` — room name string
- `expires_at` — optional ISO date string
- `allow_retake` — optional boolean
- `file` — CSV or JSON file
- No `allow_retake` field — one attempt per student per room, always

**CSV format:**

The CSV must have a header row with these exact column names. You can create and
edit it in Excel or Google Sheets — just export/save as `.csv` when done.

```
question,answer_a,answer_b,answer_c,answer_d,correct,explanation
```

| Column | Required | Notes |
|--------|----------|-------|
| `question` | Yes | The question text |
| `answer_a` | Yes | First answer choice (always required) |
| `answer_b` | Yes | Second answer choice (always required) |
| `answer_c` | No | Third answer choice (leave blank if only 2 answers) |
| `answer_d` | No | Fourth answer choice (leave blank if only 3 answers) |
| `correct` | Yes | **0-indexed number** — 0 = answer_a, 1 = answer_b, 2 = answer_c, 3 = answer_d |
| `explanation` | No | Shown after submit — explains why the answer is correct |

**Full example (copy this as a starting template):**

```csv
question,answer_a,answer_b,answer_c,answer_d,correct,explanation
"What does CIA stand for in cybersecurity?","Confidentiality Integrity Availability","Central Intelligence Agency","Cyber Intrusion Analysis","Classified Information Access",0,"The CIA Triad (Confidentiality Integrity Availability) is the foundation of cybersecurity."
"Which of the following is an example of phishing?","Updating your antivirus","An email asking you to click a link to verify your account","Using a strong password","Encrypting your hard drive",1,"Phishing attacks impersonate trusted sources to trick users into revealing credentials."
"True or False: You should use the same password for all accounts.","True","False",,1,"Reusing passwords means one breach exposes all your accounts. Use a password manager."
```

**Tips for filling it out in Excel/Google Sheets:**
- Each row = one question
- If a question only has 2 or 3 answers, leave `answer_c` and/or `answer_d` blank
- The `correct` column is just a number — double-check it matches the right answer column
- Wrap any text containing commas in double quotes (Excel does this automatically on export)
- Save/export as **CSV UTF-8** format

- Minimum 2 answers required per question, maximum 4
- `explanation` is optional but recommended

**JSON format** (matches existing topic quiz shape):
```json
[
  {
    "question": "...",
    "answers": ["...", "...", "...", "..."],
    "correct": 0,
    "explanation": "..."
  }
]
```

**Validation rules:**
- At least 1 question required
- Each question must have 2–4 non-empty answers
- `correct` must be a valid index into `answers`
- Max 100 questions per room
- Return 400 with a descriptive error message on any failure

**Room code generation:**
- Format: `XXXX-XXXX` (uppercase alphanumeric, no ambiguous chars like 0/O/1/I)
- Regenerate on collision (extremely rare)

---

## Phase 4 — Instructor Panel (Frontend)

### Page: `/instructor`
- Gated: redirect to home if `currentUser.role` is not `instructor` or `admin`
- Nav link "Instructor Panel" visible only to those roles

### UI sections

**Create Room**
- Text input: room title
- File picker: accepts `.csv` and `.json`
- Optional: expiry date/time picker
- Submit → shows generated room code + copyable link on success
- Inline validation errors if upload fails

**My Rooms**
- Table: title, code, status (open/closed), question count, attempt count, created date
- Actions per row: Copy link, Close/Reopen, View Results, Delete
- Delete uses the themed `confirmDialog`

**Results view** (within the same page, or slide-in panel)
- Room title + code at top
- Summary: X students attempted, average score Y/Z
- Roster table: username, score, completed_at
- Expandable per-student row showing each question and their answer (correct/wrong highlighted)
- "Export CSV" button — downloads the roster as a flat CSV

---

## Phase 5 — Student Quiz Room Flow

### Page: `/quiz` (entry) and `/quiz/:code` (room)

**`/quiz` — room code entry**
- Simple page: text input for room code + "Enter" button
- Must be logged in (redirect to login modal if not)
- On submit: redirect to `/quiz/:code`

**`/quiz/:code` — take the quiz**
- Worker validates: room exists, status is open, not expired
- If student already has an attempt: show their previous score and answer breakdown, no re-entry
- Otherwise: render all questions — answers are selectable but **nothing is marked right/wrong yet**
- A "Submit Quiz" button at the bottom is disabled until every question has a selection
- On submit: `POST /api/rooms/:code/attempt` — server saves the attempt and returns results
- After submission: reveal correct/wrong highlighting and explanations for all questions, show final score
- No "Try Again" — this is a final submission. No re-entry after submit.

> **Note:** The existing `renderQuiz` function marks answers immediately on click and
> cannot be reused here. The quiz room needs a new `renderRoomQuiz` function that:
> (1) tracks selections in memory without marking them, (2) enables the Submit button
> once all questions are answered, (3) reveals results only after the server responds.

### Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/rooms/:code/join` | member+ | Validate code, return room metadata + questions |
| `POST` | `/api/rooms/:code/attempt` | member+ | Submit answers, save attempt + answers |
| `GET` | `/api/rooms/:code/my-attempt` | member+ | Check if student already attempted |

---

---

## Phase 6 — Admin User Management

### Page: `/admin` (tab within or linked from `/instructor`)
- Gated: redirect to home if `currentUser.role !== 'admin'`
- Nav shows a 🔧 dropdown for elevated roles — "Instructor Panel" for instructor+, "Admin Panel" for admin only

### UI sections

**User List**
- Table: username, role, created date, action buttons
- Paginated or scrollable if user count grows
- Search/filter by username

**Actions per user**
- **Change role** — dropdown to set `member`, `instructor`, or `admin`; confirm with themed dialog before demoting an admin
- **Delete account** — themed `confirmDialog`; cascades to delete their quiz attempts and results
- Admin cannot delete or demote their own account (button disabled with tooltip)

### Backend endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/users` | admin | List all users (id, username, role, created_at) |
| `PATCH` | `/api/admin/users/:id` | admin | Update role |
| `DELETE` | `/api/admin/users/:id` | admin | Delete user + cascade their data |

**Rules:**
- Admin cannot modify their own account via these endpoints (enforced server-side)
- Role value must be one of `member`, `instructor`, `admin` — reject anything else

---

## Implementation Order

1. **Phase 1** — Role system ✅ complete
2. **Phase 6** — Admin user management ✅ complete
3. **Phase 2** — DB schema ✅ complete
4. **Phase 3** — Backend endpoints ✅ complete
5. **Phase 4** — Instructor panel UI ✅ complete
6. **Phase 5** — Student quiz room UI

---

## Out of Scope (for now)

- Real-time results dashboard (can revisit with Durable Objects later)
- Room-level leaderboards
- Question randomization / answer shuffling
- Time limits per quiz
