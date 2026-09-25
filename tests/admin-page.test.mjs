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

  test("no leftover debug output ships in the page", () => {
    assert.ok(!html.includes("console.log("), "console.log left in the console page");
    assert.ok(!html.includes("DBG"), "debug marker left in the console page");
    assert.ok(!/TODO|FIXME/.test(html), "todo marker left in the console page");
  });
});
