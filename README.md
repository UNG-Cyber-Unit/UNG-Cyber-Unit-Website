# CyberUnit @ UNG

An interactive cybersecurity education website for the **University of North Georgia Boar's Head Brigade Cyber Unit**.

Covers beginner cybersecurity topics with quizzes, an about page with the unit's org structure, and an SOP link.

Built with **Cloudflare Workers** and vanilla HTML/CSS/JS.

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
| Static assets | Cloudflare Workers Assets (`./public`) |
| Frontend | Vanilla HTML / CSS / JS |
| Deployment | Wrangler CLI |

---

## Project Structure

```
cybersec-basics/
├── public/
│   ├── index.html        # Home / topic grid
│   ├── topic.html        # Individual topic viewer
│   ├── resources.html    # External learning links
│   ├── about.html        # Unit overview and org chart
│   ├── css/              # Global stylesheet
│   ├── images/           # Topic images
│   └── js/               # Client-side scripts
├── worker.js             # Cloudflare Worker — routing + API + security headers
├── wrangler.toml         # Cloudflare Workers configuration
└── package.json
```

---

## Routes

| Route | Description |
|-------|-------------|
| `/` | Home page with topic grid |
| `/topic/:id` | Individual topic with quiz |
| `/resources` | External learning resources |
| `/about` | Unit overview and org chart |
| `/sop` | Cyber Unit SOP (PDF) |
| `/api/topics` | JSON list of all topics (summary) |
| `/api/topic/:id` | JSON data for a single topic |

---

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)

### Setup

```bash
npm install
```

### Run locally

```bash
npx wrangler dev
```

The site will be available at `http://localhost:8787`.

---

## Deployment

```bash
npx wrangler deploy
```

Requires a Cloudflare account with Workers enabled. Authenticate first with `wrangler login`.

---

## License

MIT
