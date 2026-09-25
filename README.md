<p align="center">
  <img src="./assets/lumina-logo-light.png" alt="Lumina Frameworks" width="120" />
</p>

<h1 align="center">Lumina Frameworks</h1>

<p align="center">
  <strong>Build smarter with AI</strong>
</p>

<p align="center">
  Official site for Lumina Frameworks: A Malaysia-based AI agency and training hub<br />
  helping businesses automate, scale, and ship with practical autonomous agents.
</p>

<p align="center">
  <a href="https://luminaframework.pages.dev"><img src="https://img.shields.io/badge/live-luminaframework.pages.dev-1aa3ff?style=for-the-badge&labelColor=05060a" alt="Live site" /></a>
  <a href="https://lumina-frameworks.com"><img src="https://img.shields.io/badge/domain-lumina--frameworks.com-0d6fd4?style=for-the-badge&labelColor=05060a" alt="Domain" /></a>
  <a href="https://t.me/+XZKbCeNqQs4zZjNl"><img src="https://img.shields.io/badge/telegram-@luminaframeworks-2AABEE?style=for-the-badge&labelColor=05060a" alt="Telegram" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/stack-HTML%20%2B%20CSS%20%2B%20JS-eef3f8?style=flat-square&labelColor=11131c" alt="Stack" />
  <img src="https://img.shields.io/badge/host-Cloudflare%20Pages-F38020?style=flat-square&labelColor=11131c" alt="Cloudflare Pages" />
  <img src="https://img.shields.io/badge/chat-OpenRouter%20%2F%20Lumi-7dd9ff?style=flat-square&labelColor=11131c" alt="Lumi chat" />
  <img src="https://img.shields.io/badge/theme-dark%20%2F%20light-0d6fd4?style=flat-square&labelColor=11131c" alt="Themes" />
</p>

---

## Overview

This repository powers the **Lumina Frameworks** marketing site: a single-page experience with Swiss-precision layout, micro-interactions, a boot splash, and an embedded AI concierge named **Lumi**.

Visitors can explore engagement models, estimate automation ROI, browse courses, and reach the team, all from one crafted surface. Behind the sign-in gate at `/admin.html` sits the console that runs it: a project CMS, an access roster, and a full audit trail of every action taken on the site.

| Surface | Purpose |
| --- | --- |
| **Splash** | Boot sequence with theme-aware logo mark |
| **Hero** | Brand-first intro with CLI terminal accent |
| **Services** | DIY · DWY · DFY engagement paths |
| **ROI Calculator** | Estimate savings from workflow automation |
| **Courses** | Local LLMs, Hermes agents, agentic coding, and packs |
| **Portfolio** | Selected work (Write Genius, Lumina site craft) |
| **About / Contact** | Founders, mission, and lead capture |
| **Lumi** | On-site guide-bot via OpenRouter (key stays server-side) |
| **Admin console** | Google-gated CMS: projects, access roster, audit trail |

---

## Engagement models

```
DIY ¹  Do It Yourself     courses & templates     RM29 – RM399
DWY ²  Done With You      collaborative build     RM500 – RM2,000
DFY ³  Done For You       full AI department      RM2K – RM100K
```

### Courses & packs

| Offering | Price |
| --- | --- |
| Local LLM Setup | RM39 |
| AI Agent (Hermes) | RM49 |
| Agentic Coding | RM49 |
| Starter Pack | RM99 |
| Pro Pack | RM199 |
| Ultimate Pack | RM399 |

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Vanilla HTML, CSS, JS (`index.html`) |
| Design | Custom tokens, chamfered geometry, dark / light themes |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com/) |
| API | Pages Functions: `/api/chat`, `/api/contact` |
| LLM | OpenRouter (`deepseek/deepseek-v4-flash` by default) |
| Contact mail | Resend (branded HTML to Aliff + Amir) |
| Local dev | `chat-server.mjs` (static + chat/contact proxy on port `8788`) |

---

## Project structure

```
lumina-official-site/
├── public/                      # Everything served as static assets
│   ├── index.html               # Full site (UI, motion, chat client)
│   ├── projects.html            # Project archive (search / filter / sort)
│   ├── admin.html               # Admin console (Google sign-in required)
│   ├── 404.html                 # Branded not-found page
│   ├── _routes.json             # Only /api/* invokes Functions (keeps static free)
│   └── assets/                  # Logos, mascots, backdrops, project stills
│       ├── projects-feed.js     # Public feed + the escaping guards both use
│       └── admin-utils.js       # Console-only client helpers (roles, formats, CSV)
├── chat-server.mjs              # Local static + chat/contact proxy (port 8788)
├── wrangler.toml                # Pages config + D1 / R2 bindings
├── package.json                 # Wrangler dev dependency + scripts
├── db/
│   ├── schema.sql               # D1 schema (idempotent: safe to re-run)
│   └── seed.sql                 # The original 10 projects
├── tests/
│   ├── helpers/d1-sqlite.mjs    # D1-shaped shim over node:sqlite
│   ├── projects-auth.test.mjs   # Validation, sessions, allowlist, Lumi prompt
│   ├── api.test.mjs             # Route handlers vs real SQLite (no Wrangler)
│   ├── auth-google.test.mjs     # Google ID token verification, adversarially
│   ├── chat.test.mjs            # Chat proxy builds its prompt from D1
│   ├── frontend.test.mjs        # Client-side escaping, URL guards, console helpers
│   ├── admin-console.test.mjs   # Roster, role gates, tracked sessions, audit trail
│   └── admin-page.test.mjs      # Console markup wiring (ids, icons, tabs)
├── functions/
│   ├── _shared/
│   │   ├── auth.js              # Session cookie + Google ID token verification
│   │   ├── emails.js            # The ADMIN_EMAILS bootstrap list, in one place
│   │   ├── admins.js            # Roster, roles, sessions, project diffs
│   │   ├── audit.js             # Audit context, writes, filters, CSV, prune
│   │   ├── projects.js          # D1 access, row mapping, validation
│   │   ├── lumi-prompt.js       # Lumi system prompt (projects read from D1)
│   │   └── contact-email.js     # Branded HTML email template + Resend send
│   └── api/
│       ├── chat.js              # Production chat proxy
│       ├── contact.js           # Contact form → Aliff + Amir
│       ├── projects.js          # Public project feed
│       ├── auth/                # config · google · logout · me
│       └── admin/               # projects CRUD · upload · members · audit · sessions
└── .env.example                 # Env var template (safe to commit)
```

`pages_build_output_dir` points at `public/`, so server code, `db/`, and `tests/`
are never uploaded as static assets.

---

## Admin CMS

Projects live in D1 and are edited at `/admin.html`. The console is tabbed:

| Tab | What it does |
| --- | --- |
| **Overview** | Project, roster, session, and activity counts, a 14-day histogram of actions, the recent trail, and who is signed in right now |
| **Projects** | Search, filter, and edit the portfolio. Publishing is one form submit, no HTML edits |
| **Admin manager** | Who has access and as what. Owners only |
| **Audit log** | Every action taken on this console, filterable and exportable to CSV |

### Endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/projects` | public | Published projects (`?featured=1` for the carousel) |
| `GET /api/auth/config` | public | Google client ID for the login button |
| `POST /api/auth/google` | public | Verifies an ID token, opens a tracked session |
| `POST /api/auth/logout` | public | Revokes the current session |
| `GET /api/auth/me` | public | Current session (email, role), or `{ authenticated: false }` |
| `GET /api/admin/overview` | viewer | Everything the first tab renders |
| `GET/POST /api/admin/projects` | viewer / admin | List all / create |
| `PUT/DELETE /api/admin/projects/:slug` | admin | Update / unpublish (`?hard=1` to delete) |
| `POST /api/admin/upload` | admin | PNG/JPEG/WebP → R2 |
| `GET /api/media/:key` | public | Streams an uploaded image out of R2 |
| `GET /api/admin/media` | admin | Lists what is actually in the bucket |
| `GET/POST /api/admin/members` | owner | Roster / grant access |
| `PUT/DELETE /api/admin/members/:email` | owner | Re-role, suspend / remove |
| `GET /api/admin/audit` | admin | Filtered trail (`?format=csv` to download) |
| `GET /api/admin/sessions` | admin | Live sessions (`?scope=all` includes revoked) |
| `DELETE /api/admin/sessions/:id` | admin | Sign one device out |

### Roles

| Role | Can |
| --- | --- |
| `viewer` | Read projects, the roster, and the trail |
| `admin` | Everything a viewer can, plus project edits, uploads, and session revocation |
| `owner` | Everything an admin can, plus inviting, re-roling, suspending, and removing admins |

`ADMIN_EMAILS` is the bootstrap and break-glass list. Those addresses are always
owners and cannot be edited from the console, so a mistake in the roster cannot
lock everyone out. Everyone else is granted in the console, no redeploy needed.

Two guarantees the backend enforces on **every** request: the email is still on
the roster, and the session row is still active. Removing or suspending someone
kills their live sessions immediately rather than whenever their cookie expires.
The last active owner cannot be demoted, suspended, or removed, and nobody can
change their own role.

### Audit log

One row per mutation and per rejected attempt, readable in the console or
downloadable as CSV:

| Field group | Contents |
| --- | --- |
| Who | Actor email and the role held at the time |
| What | Action (`project.update`), entity, record id, and a human summary |
| Change | `details.changes` carries a field-level before/after diff for edits |
| Context | Method, path, device, browser, OS, country, and a salted network hash |

The network value is the request address truncated to its `/24` (IPv4) or `/48`
(IPv6) and hashed with `AUTH_SECRET` as the pepper. It is enough to spot "same
network, three denied logins", without the table becoming a tracking database if
it ever leaked. Rows older than 180 days are pruned opportunistically from the
audit endpoint.

### How sign-in works

The browser gets a Google ID token via Google Identity Services and POSTs it to
`/api/auth/google`. The Function verifies the RS256 signature against Google's
JWKS, then checks `aud`, `iss`, `exp`, and `email_verified` before looking the
address up in the roster. Only then is a signed, `HttpOnly` session cookie
issued, carrying a `sid` that points at a row in `sessions`. There is no client
secret to store or leak, and both the roster and the session row are re-checked
on every request, so revoking access is immediate.

### First-time Cloudflare setup

```bash
npx wrangler login
npx wrangler d1 create lumina-cms      # copy database_id into wrangler.toml
npx wrangler r2 bucket create lumina-media
npm run db:schema                       # apply schema (remote)
npm run db:seed                         # load the original 10 projects
```

`db/schema.sql` is idempotent, so re-running it on a live database is safe: it
creates the missing `admins`, `sessions`, and `audit_log` tables, and seeds the
founders as owners only when the roster is still empty.

Then in **Pages → Settings → Variables and Secrets**, add:

| Name | Type | Value |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | plain | OAuth 2.0 Web client ID |
| `AUTH_SECRET` | secret | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_EMAILS` | plain | `amirhafizi443@gmail.com,aliffprime3@gmail.com` |

`ADMIN_EMAILS` is the bootstrap list: those accounts are always owners. Everyone
else is added from the console's **Admin manager** tab, which writes to D1 and
needs no redeploy.

In Google Cloud Console, add `https://lumina-frameworks.com` and
`http://127.0.0.1:8788` as **authorised JavaScript origins** on that client ID.

### Uploaded images

Uploads land in the `lumina-media` R2 bucket. A bucket is private until it is
given a public path, and by default this project serves those objects through
the Function at `functions/api/media/[[path]].js`, which streams them from R2
and lets Cloudflare cache the response at the edge. `MEDIA_BASE_URL` in
`wrangler.toml` points at that route.

To serve straight from the CDN instead, attach a custom domain to the bucket
(Cloudflare dashboard → R2 → `lumina-media` → Settings → Custom Domains, e.g.
`media.lumina-frameworks.com`) and set:

```toml
MEDIA_BASE_URL = "https://media.lumina-frameworks.com"
```

No code change is needed either way. The bucket's `r2.dev` URL is not used,
because `wrangler` cannot enable it and a private bucket answers those requests
with a 500 rather than a useful error.

`GET /api/admin/media` lists what is actually in the bucket, which is the
quickest way to tell an upload problem from a serving problem.

---

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- Optional: [Wrangler](https://developers.cloudflare.com/workers/wrangler/) for Pages preview / deploy
- An [OpenRouter](https://openrouter.ai/) API key (for Lumi chat)

### 1. Clone

```bash
git clone https://github.com/Lumina-Frameworks/lumina-official-site.git
cd lumina-official-site
```

### 2. Configure secrets

```bash
cp .env.example .dev.vars
```

Edit `.dev.vars` (never commit this file):

```env
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
OPENROUTER_REASONING=medium
SITE_URL=https://lumina-frameworks.com
RESEND_API_KEY=re_...
CONTACT_FROM=Lumina Frameworks <hello@lumina-frameworks.com>
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
AUTH_SECRET=<long random string>
ADMIN_EMAILS=amirhafizi443@gmail.com,aliffprime3@gmail.com
```

### 3. Run locally

There are two local servers, for two different jobs.

**CMS work** uses Wrangler, because it emulates D1 and R2:

```bash
npm install
npm run db:schema:local
npm run db:seed:local
npm run dev            # wrangler pages dev .
```

**Quick chat-only work** uses the lightweight Node server, which serves
`public/` and proxies chat and contact but has no database:

```bash
npm run dev:chat       # node chat-server.mjs
```

Either way, open **[http://127.0.0.1:8788](http://127.0.0.1:8788)**.

Without D1 the pages fall back to the project list baked into the HTML, so the
site still renders. `/api/contact` needs `RESEND_API_KEY` and only works
against production.

The console needs `GOOGLE_CLIENT_ID`, `AUTH_SECRET`, and `ADMIN_EMAILS` in
`.dev.vars` before its sign-in gate will do anything; without them
`/api/auth/config` reports `configured: false` and the gate says so in its
status line. Any values will do locally, but the Google account you test with
must be on `ADMIN_EMAILS` (or already in the `admins` table), and
`http://127.0.0.1:8788` has to be an authorised JavaScript origin on that client
ID for Google to hand back a token.

```bash
npm run db:schema:local   # creates admins + sessions + audit_log too
npx wrangler d1 execute lumina-cms --local --command "SELECT email, role FROM admins"
```

### 4. Tests

```bash
npm test               # node --test tests/*.test.mjs
npm run test:direct    # same tests, run in-process (no child processes)
```

| File | Covers |
| --- | --- |
| `tests/projects-auth.test.mjs` | Input validation, URL/image injection guards, session signing, roster membership, Lumi's prompt |
| `tests/api.test.mjs` | The real route handlers against real SQLite: schema, seed, public feed, auth guard, CRUD, R2 upload, and the media route's round trip |
| `tests/auth-google.test.mjs` | Google ID token verification: signature, `aud`/`iss`/`exp`, `alg:none` downgrade, attacker keys |
| `tests/chat.test.mjs` | That the chat proxy builds Lumi's prompt from D1 rather than the fallback list |
| `tests/frontend.test.mjs` | The public pages' guards and the console's client helpers: `escapeHtml`, `safeUrl`, `safeImage`, payload normalisation, role checks, timestamp formatting, CSV building |
| `tests/admin-console.test.mjs` | Role gates, tracked sessions and immediate revocation, roster guard rails, the audit trail and its CSV export |
| `tests/admin-page.test.mjs` | That the console's markup is wired: every `getElementById` target exists, every icon resolves, tabs match panels |

`api.test.mjs`, `chat.test.mjs`, and `admin-console.test.mjs` are deliberately
Wrangler-free. D1 is SQLite and Node ships `node:sqlite`, so they apply the
actual `db/schema.sql` and `db/seed.sql` and drive the actual handlers with a
small D1-shaped shim (`tests/helpers/d1-sqlite.mjs`). That covers the SQL, the
bind order, the column names, and the auth guard without a Cloudflare account.

`auth-google.test.mjs` needs no Google account either: it generates its own RSA
keypair, serves it as the JWKS by stubbing `fetch`, and signs its own tokens so
the rejection paths can be tested properly.

What these do **not** cover: the live Google handshake against Google's real
keys, and real R2 behaviour.

> `npm test` spawns child processes and can be blocked by a restricted sandbox;
> `npm run test:direct` runs the same assertions in-process.
---

## Deploy (Cloudflare Pages)

This repo is configured as a Pages project (`wrangler.toml`):

```toml
name = "luminaframework"
pages_build_output_dir = "./public"
```

**Production checklist**

1. Connect the GitHub repo to Cloudflare Pages (or deploy with Wrangler).
2. Apply the D1 schema and seed (see Admin CMS above).
3. Set environment variables in **Pages → Settings → Variables and Secrets**:
   - `OPENROUTER_API_KEY` (secret)
   - `RESEND_API_KEY` (secret)
   - `GOOGLE_CLIENT_ID`
   - `AUTH_SECRET` (secret)
   - `ADMIN_EMAILS`
   - `OPENROUTER_MODEL` (optional)
   - `OPENROUTER_REASONING` (optional)
   - `SITE_URL`
   - `CONTACT_FROM` (verified Resend sender, e.g. `Lumina Frameworks <hello@lumina-frameworks.com>`)
4. Deploy. Routes land under `/api/`.

Verify your domain in [Resend](https://resend.com) so mail can send from `@lumina-frameworks.com` to Aliff and Amir.

```bash
npx wrangler pages deploy public --project-name=luminaframework
```

> Deploy `public/`, never `.`. Passing `.` uploads the repo root and re-exposes
> `wrangler.toml`, `chat-server.mjs`, `db/`, and `tests/` as public files, which
> is exactly the leak the `public/` restructure fixed. `npm run deploy` is the
> safer shorthand: it relies on `pages_build_output_dir` in `wrangler.toml`.

### `_headers` gotcha

Rules in `public/_headers` must use a **splat pattern**. Verified against the
live deployment:

```
/admin*      # works  -> X-Frame-Options: DENY applied
/admin.html  # silently does nothing
```

An exact path without a `*` is accepted by the file format and then never
matches, with no warning at deploy time. Always confirm a new rule landed:

```bash
curl.exe -sI https://lumina-frameworks.com/admin.html | Select-String "x-frame|x-robots"
```

---

## Lumi (guide-bot)

Lumi is the on-site concierge: sharp, practical, and scoped to Lumina services, courses, ROI fit, and contact paths.

| Environment | Entry |
| --- | --- |
| Production | `functions/api/chat.js` |
| Local | `chat-server.mjs` → `/api/chat` |

Both keep the OpenRouter key **server-side**, stream replies, and share the same system prompt (identity, pricing bands, founders, and guardrails).

---

## Brand notes

| Token | Role |
| --- | --- |
| `#1aa3ff` / `#0d6fd4` | Accent blue (dark / light) |
| `#7dd9ff` | Signal cyan |
| `#05060a` | Dark canvas |
| `#eef3f8` | Light canvas |
| Syne · Chakra Petch · Outfit · IBM Plex Mono | Display / hero / body / mono |

Visual language: geometric frames, chamfered clips, grain overlays, neural canvas motion, and theme-aware logos, not dashboard clutter.

---

## Team

| | |
| --- | --- |
| **Aliff Ros** | Co-Founder, Business & Marketing · [Arefaros](https://github.com/Arefaros) |
| **Amir** | Co-Founder, Tech & Development · [YoRzHe-HotaaRu](https://github.com/YoRzHe-HotaaRu) |

Based in Malaysia · replies within 24 hours · [Join Us for Free](https://t.me/+XZKbCeNqQs4zZjNl)

---

## License

Private repository for Lumina Frameworks. All rights reserved unless otherwise noted.

---

<p align="center">
  <sub>Lumina Frameworks · Build smarter with AI</sub>
</p>
