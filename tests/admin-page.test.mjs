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
    assert.match(html, /\.console-grid \{ grid-template-columns: 392px minmax\(0, 1fr\); \}/);
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

  test("the theme swap cross-fades behind an opaque veil", () => {
    assert.match(html, /function switchTheme\(\)/);
    // An opaque veil in the outgoing theme covers the swap: the texture PNG and
    // the JS-drawn mesh cannot interpolate, so a plain opacity dip on the body
    // flashed rather than faded.
    assert.ok(html.includes('id="theme-veil"'), "no cross-fade veil");
    assert.match(html, /\.theme-veil \{[\s\S]*?background: var\(--bg\);/);
    assert.match(html, /\.theme-veil\.is-on \{[\s\S]*?opacity: 1;/);
    assert.ok(!html.includes("is-theming"), "the old opacity-dip rules are back");
    assert.match(html, /el\.themeVeil\.classList\.add\("is-on"\)/);
    // Two frames between the swap and the release, so the repaint has landed.
    assert.match(
      html,
      /requestAnimationFrame\(\(\) => \{\s*\n\s*requestAnimationFrame\(\(\) => el\.themeVeil\.classList\.remove\("is-on"\)\)/
    );
    // Reduced motion still switches, just without the animation.
    assert.match(html, /if \(reduce\) \{\s*\n\s*applyTheme\(next\);\s*\n\s*return;/);
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
    assert.match(select[0], /openEditor\(\)/);

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
    assert.match(html, /@media \(max-width: 760px\) \{\s*\n\s*\/\* Only the audit table[\s\S]*?\.audit-table \{ display: none; \}/);
    assert.match(html, /\.audit-cards \{ display: none; \}/);
    assert.match(html, /\.audit-cards \{ display: grid; \}/);
    assert.match(html, /el\.auditCards\.innerHTML = events\.map/);
    assert.match(html, /el\.auditCards\.addEventListener\("click", \(event\) => openEventFrom\(event\.target\)\)/);
  });

  test("the admin manager is a card list on a phone", () => {
    // Same problem as the audit table: six columns need 640px. And the tiles
    // inherited the overview's four-across row while sitting inside a padded
    // card, so the label had nowhere to go.
    assert.ok(html.includes('id="admin-cards"'), "no roster card container");
    assert.match(html, /#admins-tiles \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 8px; padding: 12px; \}/);
    assert.match(html, /\.admin-cards \{ display: none; \}/);
    assert.match(html, /\.admin-cards \{ display: grid; \}/);
    assert.match(html, /\.roster-table \{ display: none; \}/);
    // The two tables must not share one switch, or hiding the audit table
    // silently takes the roster with it.
    assert.match(html, /<div class="table-scroll roster-table">/);
    assert.match(html, /<div class="table-scroll audit-table">/);
    assert.ok(!/\.table-scroll \{ display: none; \}/.test(html), "a shared table switch is back");

    // One source of truth for the row action, so the table and cards agree.
    assert.match(html, /const action = admin\.locked/);
    assert.equal((html.match(/const action = admin\.locked/g) || []).length, 1);
    assert.match(html, /el\.adminCards\.innerHTML = rows\.map/);
    assert.match(html, /el\.adminCards\.addEventListener\("click"/);
  });

  test("audit filters collapse behind a toggle on a phone", () => {
    assert.ok(html.includes('id="filters-toggle"'), "no filter toggle");
    assert.ok(html.includes('id="audit-filters"'), "no filter group");
    assert.match(html, /aria-controls="audit-filters"/);
    assert.match(html, /el\.filters\.hidden = window\.matchMedia\("\(max-width: 700px\)"\)\.matches;/);
    assert.match(html, /\.filters-toggle \{ display: none; \}/);
    assert.match(html, /\.filters-toggle \{\s*\n\s*display: inline-flex;/);
  });

  test("toolbar controls are compact, not form fields", () => {
    // `.filters` used `display: contents`, promoting the selects to direct flex
    // children of the toolbar. Every control here carries `width: 100%` from the
    // form rule, so each one stretched the full width and took a row of its own.
    assert.ok(!html.includes(".filters { display: contents; }"), "display: contents is back");
    assert.match(html, /\.filters \{\s*\n\s*display: flex; flex-wrap: wrap; align-items: center; gap: 8px;/);
    // And the toolbar fields opt out of the form width.
    assert.match(html, /\.filters select,\s*\n\s*\.filters input\[type="date"\] \{\s*\n\s*width: auto;/);
    assert.match(html, /\.search\.compact \{ flex: 0 1 240px; width: auto; padding: 6px 10px; \}/);
    assert.match(html, /class="search compact"/);
    // Dates carry a visible label only where the layout has room for one.
    assert.match(html, /\.date-label \{ display: none; \}/);
    assert.match(html, /\.date-label \{\s*\n\s*display: block;/);
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

  test("a phone bar keeps only the hamburger, brand and theme button", () => {
    // The operator line and the two actions are one tap away in the drawer, and
    // the operator line is already the drawer's footer.
    assert.match(html, /\.bar #quick-logout, \.bar #view-site \{ display: none; \}/);
    assert.match(html, /\.bar \.operator \{ display: none; \}/);
    // Keyed on a class on the bar, NOT on `hidden`: openConsole reveals these by
    // removing `hidden`, so a plain CSS hide would have broken desktop instead.
    assert.match(html, /\.bar\.is-live #operator-chip \{ display: flex; \}/);
    assert.match(html, /el\.bar\.classList\.add\("is-live"\)/);
    assert.ok(!/el\.(logout|viewSite|operatorChip)\.classList\.remove\("hidden"\)/.test(html), "the JS still toggles hidden");
  });

  test("the ink indicator survives a hidden tab strip", () => {
    // On a phone the strip is display:none, so offsetWidth is 0 and the ink
    // would snap to the left edge under a strip that is not even rendered.
    assert.match(html, /\.tabs \{ display: none; \}/);
    assert.match(html, /if \(!active\.offsetParent\) return;/);
  });

  test("the overview tiles are one row of four on a phone", () => {
    // Four tall stacked cards were a column of scrolling for four numbers.
    assert.match(html, /\.tiles \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); gap: 8px; \}/);
    // The desktop rule keeps the flexible auto-fit grid.
    assert.match(html, /\.tiles \{ display: grid; gap: 14px; grid-template-columns: repeat\(auto-fit, minmax\(215px, 1fr\)\); \}/);

    // Detail lines fold away rather than being cut off mid-word.
    assert.match(html, /\.tile-value small \{ display: none; \}/);
    assert.match(html, /\.tile-foot \{\s*\n\s*display: -webkit-box; -webkit-line-clamp: 2;/);
    // And below 400px only the number and its icon survive.
    assert.match(html, /@media \(max-width: 400px\) \{[\s\S]*?\.tile-foot \{ display: none; \}/);
  });

  test("tiles carry a short label so nothing truncates", () => {
    // "LIVE SESSIONS" does not fit a quarter of a 360px screen.
    assert.match(html, /\.tile-label-short \{ display: none; \}/);
    assert.match(html, /\.tile-label-full \{ display: none; \}/);
    assert.match(html, /\.tile-label-short \{ display: inline; \}/);
    assert.match(html, /shortLabel: "Sessions"/);
    assert.match(html, /shortLabel: "24 hours"/);
    assert.match(html, /shortLabel: "Works"/);
    // Both tile groups supply them, or one group truncates again.
    assert.equal((html.match(/shortLabel:/g) || []).length, 8, "a tile is missing its short label");
  });

  test("the phone projects view is a two-step drill-down", () => {
    // Stacking the rail above the editor left ~470px of list and then a dead
    // panel below it, which is a lot of scrolling for no destination.
    assert.match(html, /body\.project-open #panel-projects > \.console-grid > aside \{ display: none; \}/);
    assert.match(html, /body\.project-open #editor-panel \{ display: block;/);
    assert.match(html, /#editor-panel \{ display: none; \}/);
    // Desktop keeps both panes: the grid is untouched above the split point.
    assert.match(html, /\.console-grid \{ grid-template-columns: 392px minmax\(0, 1fr\); \}/);

    // The rail is the whole screen now, so it gets the whole height and a
    // sticky filter bar.
    assert.match(html, /\.list \{ max-height: none; \}/);
    assert.match(html, /\.list-tools \{ position: sticky; top: var\(--bar-h\);/);

    // A back affordance, because there is no browser-back inside a tab.
    assert.ok(html.includes('id="editor-back"'), "no back button");
    assert.match(html, /\.editor-back \{ display: none; \}/);
    assert.match(html, /\.editor-back \{[\s\S]*?display: inline-flex;/);
    assert.match(html, /el\.editorBack\.addEventListener\("click", showProjects\)/);
    // New project opens the second step; saving returns to the first.
    assert.match(html, /openEditor\(\);\s*\n\s*F\.title\.focus\(\);/);
    assert.match(html, /if \(isHandset\(\)\) showProjects\(\);/);
    // Rotating to a tablet drops the drill-down.
    assert.match(html, /if \(event\.matches\) document\.body\.classList\.remove\("project-open"\);/);
  });

  test("unsaved edits are not silently lost", () => {
    assert.match(html, /if \(state\.dirty\) \{/);
    assert.match(html, /Leave without saving\?/);
    assert.match(html, /window\.addEventListener\("beforeunload"/);
    // Loading the form is a snapshot, not an edit.
    assert.match(html, /state\.dirty = false;\s*\n    \}\s*\n\s*\n    function setFormDisabled/);
    assert.match(html, /el\.editor\.addEventListener\("input", \(\) => \{ state\.dirty = true; \}\)/);
  });

  test("the audit log is readable before the filters", () => {
    // Five stacked controls filled the viewport before a single entry, so the
    // filters collapse behind a toggle that sits beside the search field.
    assert.match(html, /\.toolbar \{\s*\n\s*display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
    assert.match(html, /\.filters \{ display: grid; grid-column: 1 \/ -1; gap: 8px; \}/);
    // The toggle stands alone as an icon until the row can fit its label.
    assert.match(
      html,
      /@media \(max-width: 700px\) and \(min-width: 420px\) \{\s*\n\s*\.filters-toggle \.btn-label \{ display: inline; \}/
    );
    // A card is the summary plus one meta line, not four stacked blocks.
    assert.match(html, /\.audit-card \{\s*\n\s*display: grid; gap: 5px;/);
    assert.match(html, /\.a-meta \{[\s\S]*?font-size: 9\.5px;/);
  });

  test("the desktop console is viewport-bound with internal scroll areas", () => {
    // An application surface, not a document: the bar and tab strip stay put
    // and each section owns its own scroll region.
    assert.match(html, /body\.is-console \{ height: 100dvh; overflow: hidden; display: flex; flex-direction: column; \}/);
    assert.match(html, /body\.is-console \.console \{ flex: 1 1 auto; min-height: 0;/);
    // Every link in a flex chain needs min-height: 0, or the item refuses to
    // shrink below its content and the page grows a scrollbar anyway.
    assert.match(html, /\.tabpanel\.is-active \{ flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; \}/);
    assert.match(html, /\.tabpanel > \.frame \{ flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; \}/);
    // Each section has its own scroller.
    assert.match(html, /\.list \{ flex: 1 1 auto; min-height: 0; max-height: none; \}/);
    assert.match(html, /#editor-panel > \.editor \{ flex: 1 1 auto; min-height: 0; overflow-y: auto; \}/);
    assert.match(html, /\.roster-table \{ flex: 1 1 auto; min-height: 0; \}/);
    assert.match(html, /\.audit-cards \{ flex: 1 1 auto; min-height: 0; overflow-y: auto; display: none; \}/);
    // The class only exists while the console is open, and the phone keeps a
    // normal scrolling document.
    assert.match(html, /document\.body\.classList\.add\("is-console"\)/);
    assert.match(html, /@media \(max-width: 899px\) \{\s*\n\s*body\.is-console \{ height: auto; overflow: visible; display: block; \}/);
    // Leaving must release the lock: an auth failure lands on the gate, which
    // is a normal document.
    assert.match(html, /document\.body\.classList\.remove\("is-console"\);/);
  });

  test("the desktop editor pane has a definite height to scroll within", () => {
    // A grid item's automatic minimum size is its content, so without a
    // definite height on the item the frame grew to fit the form and there was
    // nothing left to scroll.
    assert.match(html, /\.console-grid \{\s*\n\s*display: grid; gap: 14px; grid-template-columns: 1fr;[\s\S]*?align-items: stretch;/);
    assert.match(html, /\.console-grid \{ flex: 1 1 auto; min-height: 0; align-items: stretch; \}/);
    assert.match(html, /\.console-grid > \.frame \{ min-height: 0; overflow: hidden; display: flex; flex-direction: column; \}/);
    // The phone drill-down wants natural height instead.
    assert.match(html, /\.console-grid \{ align-items: start; \}/);
    // Row columns are declared in both the base rule and the desktop override,
    // so the badge cannot end up sharing a track with the text.
    assert.match(html, /\.row \{[\s\S]*?grid-template-columns: 36px minmax\(0, 1fr\) auto;/);
    assert.match(html, /\.row-badge \{[\s\S]*?grid-column: 3; grid-row: 1 \/ span 2;/);
    assert.match(html, /\.row-sub \{[\s\S]*?margin-top: 2px;/);
  });

  test("no leftover debug output ships in the page", () => {
    assert.ok(!html.includes("console.log("), "console.log left in the console page");
    assert.ok(!html.includes("DBG"), "debug marker left in the console page");
    assert.ok(!/TODO|FIXME/.test(html), "todo marker left in the console page");
  });
});
