/**
 * Shared project feed for the public site.
 *
 * Loaded as a plain script (no build step) and exposed on
 * window.LuminaProjects. The HTML pages keep their original hardcoded arrays as
 * a fallback, so the grid still renders if the API is unreachable.
 *
 * The global scope is passed in rather than assumed, so this file can also be
 * imported under Node by the test suite.
 */
(function (globalScope) {
  "use strict";

  var ESCAPE_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  /**
   * Escapes a value for safe interpolation into innerHTML.
   * Every project field is admin-editable now, so nothing gets injected raw.
   */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value).replace(
      /[&<>"']/g,
      function (char) {
        return ESCAPE_MAP[char];
      }
    );
  }

  /** Only http(s) links are allowed through. Blocks javascript: and data:. */
  function safeUrl(value) {
    var url = String(value || "").trim();
    return /^https?:\/\/\S+$/i.test(url) ? url : "";
  }

  /**
   * Image sources may be a relative asset path or an absolute media URL.
   * Anything else is dropped so an admin field can't smuggle in a script URL.
   */
  function safeImage(value) {
    var src = String(value || "").trim();
    if (/^https?:\/\/\S+$/i.test(src)) return src;
    if (/^\.?\/[^\s"']*$/.test(src)) return src;
    return "";
  }

  function asArray(value) {
    return Array.isArray(value) ? value.filter(function (item) {
      return typeof item === "string" && item.length;
    }) : [];
  }

  function normalise(raw) {
    return {
      id: String(raw.id || raw.slug || ""),
      slug: String(raw.slug || raw.id || ""),
      title: String(raw.title || ""),
      symbol: String(raw.symbol || ""),
      category: String(raw.category || ""),
      year: Number(raw.year) || 0,
      image: safeImage(raw.image || raw.image_url),
      blurb: String(raw.blurb || ""),
      tagline: String(raw.tagline || ""),
      stack: asArray(raw.stack),
      tags: asArray(raw.tags),
      url: safeUrl(raw.url),
      featured: Boolean(raw.featured)
    };
  }

  /**
   * Fetches published projects.
   * @param {{featured?: boolean}} options
   * @returns {Promise<Array>} normalised projects
   */
  function loadProjects(options) {
    var featured = options && options.featured;
    var path = "/api/projects" + (featured ? "?featured=1" : "");

    return fetch(path, { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("Projects API returned " + response.status);
        return response.json();
      })
      .then(function (data) {
        var list = Array.isArray(data && data.projects) ? data.projects : [];
        if (!list.length) throw new Error("Projects API returned an empty list");
        return list.map(normalise);
      });
  }

  globalScope.LuminaProjects = {
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    safeImage: safeImage,
    normalise: normalise,
    loadProjects: loadProjects
  };
})(typeof window !== "undefined" ? window : globalThis);
