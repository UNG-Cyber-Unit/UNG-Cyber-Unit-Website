# CyberUnit @ UNG

An interactive cybersecurity education website for the **University of North Georgia Boar's Head Brigade Cyber Unit**.

Covers beginner cybersecurity topics with quizzes, an about page with the unit's org structure, an SOP link, user accounts with progress tracking, and instructor-hosted live Quiz Rooms.

Built with **Cloudflare Workers**, **D1**, and vanilla HTML/CSS/JS.

---

## Topics Covered

| # | Topic |
|---|-------|
| 01 | What is Cybersecurity? (CIA Triad) |
| 02 | Types of Threats |
| 03 | Passwords & Authentication |
| 04 | Phishing & Social Engineering |
| 05 | Networking Basics for Security |
| 06 | Encryption Basics |
| 07 | Safe Browsing & Digital Hygiene |
| 08 | Linux & Command Line Basics |
| 09 | Incident Response Basics |
| 10 | Careers in Cybersecurity |
| 11 | Bash Basics for Kali Linux |

Each topic includes reading content and a 3-question quiz with instant feedback.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (`schema.sql`) |
| Static assets | Cloudflare Workers Assets (`./public`) |
| Frontend | Vanilla HTML / CSS / JS |
| Auth | Custom JWT (HS256) + PBKDF2 password hashing, HttpOnly session cookie |
| Deployment | Wrangler CLI, auto-deployed on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`) |

---

## Project Structure

```
cybersec-basics/
├── public/
│   ├── index.html         # Home / topic grid
│   ├── topic.html         # Individual topic viewer
│   ├── resources.html     # External learning links
│   ├── about.html         # Unit overview and org chart
│   ├── admin.html         # Admin panel (user/role management)
│   ├── instructor.html    # Instructor panel (create/manage Quiz Rooms)
│   ├── quiz.html          # Student: join a Quiz Room by code
│   ├── quiz-room.html     # Student: live Quiz Room attempt
│   ├── css/               # Global stylesheet
│   ├── images/            # Topic images
│   └── js/                # Client-side scripts
├── worker.js              # Cloudflare Worker — canonical entry point: routing, API, auth, security headers
├── server.js               # Legacy Express prototype — static topic pages only, no auth/DB/Quiz Rooms; not deployed, kept for optional local preview
├── schema.sql              # D1 schema (users, quiz_results, quiz_rooms, quiz_room_questions, quiz_room_attempts, quiz_room_answers)
├── wrangler.toml           # Cloudflare Workers configuration
└── package.json
```

> **Note on `server.js`:** this was the original Express-based prototype and predates the account system, D1 database, and Quiz Rooms feature. It is **not used in production** — `wrangler deploy` runs `worker.js` exclusively. It's kept around only as a lightweight way to preview the static topic pages with `npm start`/`npm run dev`, and does not reflect current functionality (no login, progress tracking, admin/instructor panels, or Quiz Rooms).

---

## Routes

### Pages

| Route | Description |
|-------|-------------|
| `/` | Home page with topic grid |
| `/topic/:id` | Individual topic with quiz |
| `/resources` | External learning resources |
| `/about` | Unit overview and org chart |
| `/sop` | Cyber Unit SOP (PDF) |
| `/instructor` | Instructor panel — create and manage Quiz Rooms |
| `/quiz` | Student — join a Quiz Room by code |
| `/quiz/:code` | Student — take a live Quiz Room |

### API

| Route | Description |
|-------|-------------|
| `/api/topics` | JSON list of all topics (summary) |
| `/api/topic/:id` | JSON data for a single topic |
| `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` | Account auth |
| `/api/progress` | Logged-in user's per-topic quiz progress |
| `/api/admin/users` | Admin — list/manage users |
| `/api/rooms` | Instructor — create/list Quiz Rooms |
| `/api/rooms/:code/join`, `/attempt`, `/my-attempt`, `/results` | Quiz Room join/attempt flow |

---

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)

### Setup

```bash
npm install
```

### Run locally (full app — recommended)

```bash
npx wrangler dev
```

The site will be available at `http://localhost:8787`, backed by D1 and the full auth/Quiz Rooms feature set.

### Run locally (static preview only, via `server.js`)

```bash
npm start        # or: npm run dev (nodemon, auto-reload)
```

Serves only the static topic pages on Express — no auth, no database, no Quiz Rooms. Useful for a quick content-only preview without Wrangler.

---

## Deployment

Deployment is automated: pushing to `main` triggers `.github/workflows/deploy.yml`, which runs `wrangler deploy` using the `CLOUDFLARE_API_TOKEN` repo secret.

To deploy manually:

```bash
npx wrangler deploy
```

Requires a Cloudflare account with Workers enabled. Authenticate first with `wrangler login`.

---

## License

MIT
