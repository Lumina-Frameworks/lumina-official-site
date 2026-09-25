/**
 * Structural checks for the admin console page.
 * Run: node tests/admin-page.test.mjs
 *
 * The console is one file with no build step and no bundler, so a typo in an id
 * or an icon name fails silently at runtime: the element is null, or the SVG
 * renders as nothing at all. There is no browser in this test loop, so these
 * assertions are the safety net for the wiring.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let html;
let utils;

before(() => {
  html = fs.readFileSync(path.join(ROOT, "public", "admin.html"), "utf8");
  // Some glyph names are chosen at runtime by admin-utils, so the sprite has to
  // satisfy both files.
  utils = fs.readFileSync(path.join(ROOT, "public", "assets", "admin-utils.js"), "utf8");
});

describe("admin.html wiring", () => {
  test("every getElementById target exists in the markup", () => {
    const declared = new Set(
      [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    );
    const referenced = new Set([
      ...[...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]),
      ...[...html.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1])
    ]);

    const missing = [...referenced].filter((id) => !declared.has(id)).sort();
    assert.deepEqual(missing, [], `markup is missing: ${missing.join(", ")}`);
    assert.ok(referenced.size > 40, `only found ${referenced.size} id references`);
  });

  test("every icon reference resolves to a symbol in the sprite", () => {
    const symbols = new Set([...html.matchAll(/<g id="(i-[^"]+)"/g)].map((m) => m[1]));
    const used = new Set([
      ...[...html.matchAll(/href="#(i-[^"]+)"/g)].map((m) => m[1]),
      ...[...utils.matchAll(/"#(i-[^"]+)"/g)].map((m) => m[1])
    ]);

    const missing = [...used].filter((name) => !symbols.has(name)).sort();
    assert.deepEqual(missing, [], `no sprite entry for: ${missing.join(", ")}`);

    // Nothing decorative should ship unused either.
    const unused = [...symbols].filter((name) => !used.has(name));
    assert.deepEqual(unused, [], `unused sprite entries: ${unused.join(", ")}`);
  });

  test("every el.* reference is declared, and every declared entry is used", () => {
    const map = html.match(/const el = \{([\s\S]*?)\n    \};/);
    assert.ok(map, "could not find the element map");
    const declared = new Set([...map[1].matchAll(/(\w+):/g)].map((m) => m[1]));
    const used = new Set([...html.matchAll(/\bel\.(\w+)/g)].map((m) => m[1]));

    assert.deepEqual([...used].filter((key) => !declared.has(key)), [], "el.* used but never declared");
    assert.deepEqual([...declared].filter((key) => !used.has(key)), [], "declared but never used");
    assert.ok(declared.size > 60, `only ${declared.size} elements mapped`);
  });

  test("the inline script parses", () => {
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(blocks.length, 2, "the theme bootstrap and the app script");
    for (const block of blocks) {
      assert.doesNotThrow(() => new Function(block), "inline script has a syntax error");
    }
  });

  test("the page loads the same guards the public site uses", () => {
    assert.match(html, /src="\.\/assets\/projects-feed\.js"/);
    assert.match(html, /src="\.\/assets\/admin-utils\.js"/);
    assert.match(html, /accounts\.google\.com\/gsi\/client/);
  });

  test("tabs, panels and their labels line up", () => {
    const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, ["overview", "projects", "admins", "audit"]);

    for (const name of tabs) {
      assert.ok(html.includes(`id="panel-${name}"`), `missing panel for ${name}`);
      assert.ok(html.includes(`id="tab-${name}"`), `missing tab button for ${name}`);
      assert.match(
        html,
        new RegExp(`aria-controls="panel-${name}"`),
        `tab ${name} does not point at its panel`
      );
    }
  });

  test("the viewer role is respected in the markup defaults", () => {
    // Write controls ship hidden or are unlocked explicitly once the session is
    // known; that keeps a read-only role from seeing actions it cannot take.
    assert.match(html, /const canWrite = \(\) => U\.can\(state\.viewer\?\.role, "admin"\)/);
    assert.match(html, /const isOwner = \(\) => U\.can\(state\.viewer\?\.role, "owner"\)/);
    assert.match(html, /el\.newProject\.classList\.toggle\("hidden", !canWrite\(\)\)/);
    assert.match(html, /el\.adminsWrap\.classList\.add\("hidden"\)/);
  });

  test("the mobile layout collapses the console to one column", () => {
    assert.match(html, /@media \(max-width: 1039px\) \{ \.list \{ max-height: 44vh; \} \}/);
    assert.match(html, /@media \(min-width: 1040px\) \{ \.console-grid \{ grid-template-columns: 350px minmax\(0, 1fr\); \} \}/);
    // Dialogs come up from the bottom edge on small screens.
    assert.match(html, /@keyframes sheetUp/);
    // Safe-area padding for notched phones.
    assert.match(html, /viewport-fit=cover/);
  });

  test("animations are skipped when the operator asked for reduced motion", () => {
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(html, /animation-duration: 0\.01ms !important/);
    assert.match(html, /const reduce = window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  });

  test("the backdrop is layered, not a flat colour", () => {
    // Mesh, paper texture, glows, grid, vignette, scanlines, frame marks. If a
    // layer is dropped the console reads as an empty page.
    for (const layer of [
      "neural-canvas",
      "backdrop-texture",
      "backdrop-glow",
      "backdrop-orb a",
      "backdrop-orb b",
      "backdrop-orb c",
      "backdrop-grid",
      "backdrop-vignette",
      "scanlines",
      "frame-marks"
    ]) {
      assert.ok(html.includes(`class="${layer}"`) || html.includes(`"${layer}"`), `missing backdrop layer: ${layer}`);
    }
    // Both themes get their own texture, since the light one is a different PNG.
    assert.match(html, /\[data-theme="light"\] \.backdrop-texture \{/);
    // And every layer must be inert to clicks.
    assert.match(html, /\.backdrop-texture \{[\s\S]*?pointer-events: none;/);
    assert.match(html, /\.frame-marks \{ position: fixed; inset: 0; z-index: 3; pointer-events: none; \}/);
  });

  test("the sign-out sequence is wired end to end", () => {
    assert.ok(html.includes('id="signout"'), "no sign-out overlay");
    assert.ok(html.includes('id="signout-status"'), "no status line in the overlay");
    assert.ok(html.includes('id="signout-sub"'), "no sub line in the overlay");
    // Eight curtain columns, matching the sign-in wipe.
    const stripes = html.match(/class="signout-layer signout-stripes"[\s\S]*?<\/div>/);
    assert.ok(stripes, "no curtain markup");
    assert.equal((stripes[0].match(/<span>/g) || []).length, 8);
    assert.match(html, /#signout\.is-closing \.signout-stripes span \{/);
    assert.match(html, /#signout\.is-gone \.signout-core \{/);
    assert.match(html, /SIGNOUT_LINES/);
    assert.match(html, /el\.logout\.addEventListener\("click", \(\) => \{/);
  });

  test("the theme toggle swaps both logo marks and fades the swap", () => {
    assert.match(html, /function switchTheme\(\)/);
    assert.match(html, /html\.is-theming body \{ opacity: 0\.45; \}/);
    assert.match(html, /if \(el\.idleMark\) el\.idleMark\.src = mark;/);
    // The preference is read before first paint, so there is no dark flash.
    assert.match(html, /localStorage\.getItem\("lumina-theme"\)/);
  });

  test("the gate heading matches the site's display scale", () => {
    // Syne at 800 is a superellipse slab; the marketing site caps its display
    // headings at 700 / 3.25rem. The console had drifted to 800 / 3.5rem.
    const rule = html.match(/\.gate-intro h1 \{[\s\S]*?\}/);
    assert.ok(rule, "no gate heading rule");
    assert.match(rule[0], /font-weight: 700;/);
    assert.ok(!rule[0].includes("font-weight: 800"), "800 is too heavy at this size");
    const size = rule[0].match(/font-size: clamp\(([\d.]+)rem/);
    assert.ok(Number(size[1]) <= 1.9, `heading starts too large: ${size[1]}rem`);
  });

  test("the Google button cannot expose its white canvas", () => {
    // The wrapper must not be stretched: the button inside is a fixed width, and
    // the gap between them shows the iframe's white background.
    const wrapper = html.match(/#gsi-button > div \{[^}]*\}/);
    assert.ok(wrapper, "no wrapper rule");
    assert.ok(!/width: 100% !important/.test(wrapper[0]), "stretching the wrapper reveals the white slab");
    assert.match(wrapper[0], /width: 300px !important/);

    // color-scheme leaking into the frame is the other half of the bug.
    assert.match(html, /#gsi-button \{ margin-bottom: 14px; color-scheme: light; \}/);
    assert.match(html, /#gsi-button iframe \{[^}]*color-scheme: light/);
    // And the requested GSI width has to match the reserved box.
    assert.match(html, /width: 300,\n\s+text: "signin_with"/);
  });

  test("the bar brand block links home", () => {
    assert.match(html, /<a class="brand-link" href="\.\/index\.html" id="brand-home"/);
    assert.match(html, /el\.brandHome\?\.addEventListener\("click", markReturn\)/);
    // Still exactly one h1 per surface's main heading, plus the editor's.
    assert.equal((html.match(/<h1/g) || []).length, 2);
  });

  test("selecting a project repaints the highlight instead of the list", () => {
    // Re-rendering on selection replaced the list's innerHTML, which restarted
    // every row's entry animation: a phantom refresh on every click.
    const select = html.match(/function selectProject\(slug\) \{[\s\S]*?\n    \}/);
    assert.ok(select, "no selectProject");
    assert.ok(!select[0].includes("renderList()"), "selection must not rebuild the list");
    assert.match(select[0], /paintActiveRow\(slug\)/);
    assert.match(select[0], /ensureEditorVisible\(\)/);

    // The entry animation must not live on .row, or toggling a class replays it.
    const row = html.match(/\n    \.row \{[\s\S]*?\n    \}/);
    assert.ok(row, "no .row rule");
    assert.match(row[0], /animation: none;/);
    assert.match(html, /\.row-sym, \.row-main, \.row-badge \{ animation: rowIn/);

    // renderList is only for new data or a changed filter, never a selection:
    // fresh fetch, search input, filter chip, and starting a new project.
    const calls = [...html.matchAll(/renderList\(\);/g)].length;
    const definitions = (html.match(/function renderList\(\)/g) || []).length;
    assert.equal(definitions, 1);
    assert.equal(calls, 4, "an unexpected renderList call site appeared");
  });

  test("the project row is a grid with a status bookmark", () => {
    // A flex line never fit: the rail is ~350px at every desktop size, so the
    // title, meta and badges fought for the same pixels and overlapped.
    const row = html.match(/\n    \.row \{[\s\S]*?\n    \}/);
    assert.ok(row, "no .row rule");
    assert.match(row[0], /display: grid; grid-template-columns: 36px minmax\(0, 1fr\) auto;/);
    assert.ok(!/display: flex/.test(row[0]), "the row went back to a flex line");

    // The grid belongs in the base rule: the constraint is the rail width,
    // which does not change with the viewport.
    assert.ok(
      !/max-width: 1039px\) \{\s*\n?\s*\.row \{/.test(html),
      "the row layout is keyed to the viewport instead of the rail"
    );

    // Symbol spans both rows, bookmark sits top right.
    assert.match(html, /\.row-sym \{[\s\S]*?grid-row: 1 \/ span 2;/);
    assert.match(html, /\.row-badge \{[\s\S]*?grid-column: 3; grid-row: 1 \/ span 2;/);

    // Text pills are gone from the list; the bookmark carries the state.
    assert.ok(!html.includes("row-pills"), "the old pill row is still in the CSS");
    assert.match(html, /\.badge-live, \.badge-feat \{ display: none; \}/);
    assert.match(html, /\.row\.is-live \.badge-live \{ display: block; color: var\(--success\); \}/);
    assert.match(html, /\.row\.is-featured \.badge-feat \{ display: block; color: var\(--accent\); \}/);
  });

  test("the status bookmarks are named, not just coloured", () => {
    assert.ok(html.includes('id="i-bookmark"'), "no bookmark glyph");
    assert.ok(html.includes('id="i-star"'), "no star glyph");
    assert.match(html, /aria-label="Published"/);
    assert.match(html, /aria-label="Featured"/);
    assert.match(html, /<title>Live<\/title>/);
    assert.match(html, /<title>Featured<\/title>/);
    // Filled on, outlined off, so the two states are distinguishable.
    assert.match(html, /\.row\.is-live \.badge-live \.live-fill \{ display: inline; \}/);
    assert.match(html, /\.row\.is-live \.badge-live \.live-line \{ display: none; \}/);
  });

  test("the staggered entry animation still animates row children", () => {
    assert.match(html, /\.row-sym, \.row-main, \.row-badge \{ animation: rowIn/);
    assert.match(html, /class="row-sym"' \+ delay/);
    assert.match(html, /class="row-main"' \+ delay/);
  });

  test("the bar actions are icon-only squares with real labels", () => {
    for (const id of ["quick-logout", "theme-toggle", "view-site"]) {
      const button = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
      assert.ok(button, `no ${id}`);
      assert.match(button[0], /icon-only/, `${id} is not icon-only`);
      assert.match(button[0], /aria-label="[^"]+"/, `${id} has no aria-label`);
      assert.match(button[0], /title="[^"]+"/, `${id} has no tooltip`);
    }
    // No leftover text labels inside those controls.
    assert.ok(!/btn-label">(Sign out|View site)/.test(html), "a text label survived in the bar");
    assert.match(html, /\.icon-only \{[\s\S]*?width: 38px/);
  });

  test("the theme button shows the theme you would switch to", () => {
    assert.match(html, /\.icon-only\.is-theme \.icon-moon \{ display: none; \}/);
    assert.match(html, /\[data-theme="light"\] \.icon-only\.is-theme \.icon-sun \{ display: none; \}/);
    assert.match(html, /\[data-theme="light"\] \.icon-only\.is-theme \.icon-moon \{ display: block; \}/);
    // Both glyphs exist, and the sparkle it replaced is gone.
    assert.ok(html.includes('id="i-sun"'), "no sun glyph");
    assert.ok(html.includes('id="i-moon"'), "no moon glyph");
    assert.ok(!html.includes('id="i-sparkle"'), "the old sparkle glyph is still in the sprite");
    // The label is set from both the theme swap and boot, so it always names an
    // action rather than a state.
    assert.match(html, /setAttribute\(\s*"aria-label",\s*next === "dark" \? "Switch to light theme" : "Switch to dark theme"\s*\)/);
    assert.match(html, /startingTheme === "dark" \? "Switch to light theme" : "Switch to dark theme"/);
  });

  test("the light theme dims the backdrop instead of inverting it", () => {
    // A bright canvas needs the layers pulled down and the panels made solid,
    // or the cards dissolve into the field behind them.
    for (const rule of [
      '[data-theme="light"] #neural-canvas { opacity: 0.5; }',
      '[data-theme="light"] .backdrop-grid { opacity: 0.32; }',
      '[data-theme="light"] .scanlines { opacity: 0.14; }'
    ]) {
      assert.ok(html.includes(rule), `missing: ${rule}`);
    }
    assert.match(html, /\[data-theme="light"\] \.backdrop-texture \{[\s\S]*?opacity: 0\.34; mix-blend-mode: multiply;/);
    assert.match(html, /\[data-theme="light"\] \.backdrop-vignette \{/);
    // Panels go opaque, and gain a shadow to replace the depth they lost.
    const lightFrame = html.match(/\[data-theme="light"\] \.frame \{[\s\S]*?\n    \}/);
    assert.ok(lightFrame, "no light-theme .frame rule");
    assert.match(lightFrame[0], /background: var\(--bg-panel\);/);
    assert.match(lightFrame[0], /box-shadow:/);
    // The base rule keeps its translucency for dark theme.
    assert.match(html, /\.frame \{ background: color-mix\(in srgb, var\(--bg-panel\) 93%, transparent\); \}/);
    // Neutral base lifted off pure white.
    assert.match(html, /--bg: #dfe6ef;/);
  });

  test("phone navigation is a drawer, not a scrolling tab strip", () => {
    assert.ok(html.includes('id="nav-toggle"'), "no hamburger");
    assert.ok(html.includes('id="drawer-panel"'), "no drawer panel");
    assert.match(html, /aria-controls="drawer-panel"/);
    // One drawer link per destination, matching the tabs.
    const targets = [...html.matchAll(/data-goto="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(targets, ["overview", "projects", "admins", "audit"]);
    // The strip is hidden rather than removed, so panel labelling survives.
    assert.match(html, /\.tabs \{ display: none; \}/);
    assert.ok(!/\.tabs \{ display: flex; gap: 4px; overflow-x: auto/.test(html.split("@media (max-width: 899px)")[1].split("@media (min-width: 900px)")[0]));
    assert.match(html, /body\.drawer-open \.drawer-panel \{ transform: none; \}/);
    // Escape and the veil both close it.
    assert.match(html, /el\.drawerVeil\.addEventListener\("click", \(\) => closeDrawer/);
    assert.match(html, /event\.key === "Escape" && document\.body\.classList\.contains\("drawer-open"\)/);
    // Drawer badges track the tab badges.
    assert.match(html, /setBadge\("badge-" \+ name, value\);/);
    assert.match(html, /setBadge\("drawer-badge-" \+ name, value\);/);
  });

  test("the audit log becomes a card list on a phone", () => {
    // The table needs 640px before it is readable; on a phone that is a
    // sideways scroll inside a page that must not scroll sideways.
    assert.ok(html.includes('id="audit-cards"'), "no mobile card container");
    assert.match(html, /@media \(max-width: 760px\) \{\s*\n\s*\.table-scroll \{ display: none; \}/);
    assert.match(html, /\.audit-cards \{ display: none; \}/);
    assert.match(html, /\.audit-cards \{ display: grid; \}/);
    assert.match(html, /el\.auditCards\.innerHTML = events\.map/);
    assert.match(html, /el\.auditCards\.addEventListener\("click", \(event\) => openEventFrom\(event\.target\)\)/);
  });

  test("audit filters collapse behind a toggle on a phone", () => {
    assert.ok(html.includes('id="filters-toggle"'), "no filter toggle");
    assert.ok(html.includes('id="audit-filters"'), "no filter group");
    assert.match(html, /aria-controls="audit-filters"/);
    assert.match(html, /el\.filters\.hidden = window\.matchMedia\("\(max-width: 700px\)"\)\.matches;/);
    assert.match(html, /\.filters-toggle \{ display: none; \}/);
    assert.match(html, /\.filters-toggle \{\s*\n\s*display: inline-flex;/);
    // The filter group must not be clobbered by the .search box rule again.
    assert.match(html, /\.filters \{ display: contents; \}/);
  });

  test("a phone never paints the fixed backdrop layers", () => {
    assert.match(
      html,
      /@media \(max-width: 899px\), \(hover: none\) and \(pointer: coarse\) \{\s*\n\s*\.backdrop-orb, \.backdrop-grid, \.scanlines, \.frame-marks \{ display: none; \}/
    );
    // Static bar, no per-frame blur over a scrolling document.
    assert.match(html, /\.bar \{ backdrop-filter: none; background: var\(--bg\); \}/);
    // And the mesh animation loop stops entirely on touch.
    assert.match(html, /window\.matchMedia\("\(max-width: 899px\), \(hover: none\) and \(pointer: coarse\)"\)\.matches/);
    // Nothing may scroll sideways.
    assert.match(html, /html \{ overflow-x: clip; \}/);
    assert.match(html, /body \{[\s\S]*?overflow-x: clip;/);
  });

  test("the drawer is hidden at desktop width", () => {
    // `display: contents` as the base rule left the panel and its veil in the
    // desktop layout as unstyled blocks between the bar and the content.
    assert.match(html, /\.drawer, \.drawer-veil, \.drawer-panel \{ display: none; \}/);
    assert.ok(!html.includes(".drawer { display: contents; }"), "the contents rule is back");
    assert.ok(!/min-width: 900px\) \{ \.drawer-veil/.test(html), "a redundant desktop override is back");

    // And the drawer only becomes real inside the phone query.
    const phone = html.slice(html.indexOf("@media (max-width: 899px) {\n      .nav-toggle"));
    assert.ok(phone.length > 0, "no phone drawer block");
    const block = phone.slice(0, phone.indexOf("\n    }"));
    assert.match(block, /\.drawer \{ display: block; \}/);
    assert.match(block, /\.drawer-panel \{\s*\n\s*display: flex; flex-direction: column;/);
    assert.match(block, /\.drawer-veil \{\s*\n\s*display: block;/);
  });

  test("a stored image URL that does not resolve says so", () => {
    // The browser's torn-page glyph reads as a broken site, which is exactly
    // what a dead media host looked like.
    assert.match(html, /function renderPreview\(\)[\s\S]*?addEventListener\("error"/);
    assert.match(html, /el\.dropPreview\.classList\.add\("is-missing"\)/);
    assert.match(html, /\.drop-preview\.is-missing \{/);
    assert.match(html, /This image URL does not load/);
  });

  test("no leftover debug output ships in the page", () => {
    assert.ok(!html.includes("console.log("), "console.log left in the console page");
    assert.ok(!html.includes("DBG"), "debug marker left in the console page");
    assert.ok(!/TODO|FIXME/.test(html), "todo marker left in the console page");
  });
});
