-- Seed: the 10 projects that were previously hardcoded in public/projects.html.
-- Idempotent: re-running will not overwrite edits made through the admin panel.
-- Apply: npx wrangler d1 execute lumina-cms --file=./db/seed.sql --remote

INSERT OR IGNORE INTO projects
  (slug, title, symbol, category, year, image_url, blurb, tagline, stack, tags, url, featured, published, sort_order)
VALUES
  ('write-genius', 'Write Genius', 'WG', 'Product', 2025,
   './assets/WG.png',
   'Academic writing platform with custom-tuned LLMs for drafting, research organization, and citation workflows.',
   'ACADEMIC WRITING PLATFORM',
   '["Custom LLMs","Research ops","Citations"]',
   '["llm","education","saas"]',
   'https://writegeniusofficial.pages.dev/', 1, 1, 1),

  ('akari', 'A.K.A.R.I.', 'AK', 'Product', 2026,
   './assets/project-akari.jpg',
   'Advanced Knowledgeable Assembly Rig Instructor. A warm beginner-first AI coach for PC building, parts, compatibility, budgets (RM), and first-boot help.',
   'PC BUILD COACH',
   '["OpenRouter","Streaming chat","Cloudflare Pages"]',
   '["llm","education","pc-build"]',
   'https://akari.lumina-frameworks.com/', 1, 1, 2),

  ('lumina-site', 'Lumina Frameworks', 'LF', 'Brand', 2026,
   './assets/project-lumina.png',
   'Studio site and brand system: Swiss-precision layout, theme-aware marks, and micro-interaction craft.',
   'STUDIO WEBSITE & BRAND',
   '["HTML/CSS/JS","Cloudflare Pages","OpenRouter"]',
   '["web","brand","motion"]',
   NULL, 1, 1, 3),

  ('arefa-hermes', 'Arefa Hermes', 'AH', 'Agent', 2026,
   './assets/arefapages.png',
   'Meet Arefa. Custom-built sentient AI with intellectually savage wit and local agentic execution sub-routines.',
   'AGENT INTERFACE',
   '["Hermes agents","Local LLMs","Automation"]',
   '["agents","local-llm","sarcasm"]',
   'https://arefa-profile.pages.dev/', 1, 1, 4),

  ('hermes-desk', 'Hermes Desk', 'HD', 'Agent', 2025,
   NULL,
   'Multi-step agent desk for tool calls, reasoning loops, and operator-approved actions across business workflows.',
   'AGENT WORKBENCH',
   '["Hermes agents","Tool calling","Guardrails"]',
   '["agents","automation","ops"]',
   NULL, 1, 1, 5),

  ('local-forge', 'Local Forge', 'LO', 'Platform', 2025,
   NULL,
   'Local LLM hosting kit: secure model serving, access controls, and offline-capable inference for teams.',
   NULL,
   '["Open-source LLMs","Self-host","Hardening"]',
   '["local-llm","security","infra"]',
   NULL, 0, 1, 6),

  ('roi-radar', 'ROI Radar', 'RR', 'Product', 2024,
   NULL,
   'Automation impact estimator used in Lumina engagements to size DIY / DWY / DFY from workload density.',
   NULL,
   '["Modeling","Workflows","RM costing"]',
   '["analytics","automation","consulting"]',
   NULL, 0, 1, 7),

  ('signal-ops', 'Signal Ops', 'SO', 'Agent', 2024,
   NULL,
   'Inbound lead triage agent that classifies interest, drafts replies, and routes DFY quotes to founders.',
   NULL,
   '["Routing","Templates","Handoff"]',
   '["agents","crm","support"]',
   NULL, 0, 1, 8),

  ('course-lattice', 'Course Lattice', 'CL', 'Education', 2025,
   NULL,
   'Curriculum system behind Local LLM, Hermes, and Agentic Coding tracks with pack-based unlocks.',
   NULL,
   '["Modules","Packs","Community"]',
   '["education","content","community"]',
   NULL, 0, 1, 9),

  ('chamfer-kit', 'Chamfer Kit', 'CK', 'Brand', 2026,
   NULL,
   'Internal UI token kit: chamfered frames, mono status labels, and accent systems for Lumina surfaces.',
   NULL,
   '["Tokens","CSS","Motion"]',
   '["design-system","web","brand"]',
   NULL, 0, 1, 10);
