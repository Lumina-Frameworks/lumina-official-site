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

Visitors can explore engagement models, estimate automation ROI, browse courses, and reach the team, all from one crafted surface.

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
├── index.html                 # Full site (UI, motion, chat client)
├── chat-server.mjs            # Local static + OpenRouter proxy
├── wrangler.toml              # Cloudflare Pages project config
├── .env.example               # Env var template (safe to commit)
├── functions/
│   ├── _shared/
│   │   └── contact-email.js   # Branded HTML email template + Resend send
│   └── api/
│       ├── chat.js            # Production chat proxy
│       └── contact.js         # Contact form → Aliff + Amir
└── assets/
    ├── lumina-logo-dark.png   # Logo for dark theme
    ├── lumina-logo-light.png  # Logo for light theme
    ├── lumina-mark-*.png/svg  # Favicon / mark variants
    ├── mascot-*.png           # Lumi expressions
    ├── hero-backdrop*.png
    ├── scroll-backdrop*.png
    └── project-*.png          # Portfolio stills
```

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
```

### 3. Run locally

```bash
node chat-server.mjs
```

Open **[http://127.0.0.1:8788](http://127.0.0.1:8788)**.

The local server serves static files and proxies `POST /api/chat` to OpenRouter with the same system prompt used in production.

> Static-only preview: open `index.html` in a browser. Chat will fail without the proxy and API key.

---

## Deploy (Cloudflare Pages)

This repo is configured as a Pages project (`wrangler.toml`):

```toml
name = "lumina-main-site-v4"
pages_build_output_dir = "."
```

**Production checklist**

1. Connect the GitHub repo to Cloudflare Pages (or deploy with Wrangler).
2. Set environment variables in **Pages → Settings → Environment variables**:
   - `OPENROUTER_API_KEY` (secret)
   - `RESEND_API_KEY` (secret)
   - `OPENROUTER_MODEL` (optional)
   - `OPENROUTER_REASONING` (optional)
   - `SITE_URL`
   - `CONTACT_FROM` (verified Resend sender, e.g. `Lumina Frameworks <hello@lumina-frameworks.com>`)
3. Deploy. Routes land at `/api/chat` and `/api/contact`.

Verify your domain in [Resend](https://resend.com) so mail can send from `@lumina-frameworks.com` to Aliff and Amir.

```bash
npx wrangler pages deploy . --project-name=lumina-main-site-v4
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
