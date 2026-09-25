/**
 * Client-side helpers for the admin console.
 *
 * Loaded as a plain script (no build step) and exposed on window.LuminaAdmin.
 * Pure functions only, so the test suite can import them under Node without a
 * DOM: escaping, role checks, audit filter serialisation, CSV building, and the
 * label formatting the audit table renders.
 */
(function (globalScope) {
  "use strict";

  var ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value).replace(
      /[&<>"']/g,
      function (char) {
        return ESCAPE_MAP[char];
      }
    );
  }

  /** Only http(s) links survive. Blocks javascript: and data:. */
  function safeUrl(value) {
    var url = String(value || "").trim();
    return /^https?:\/\/\S+$/i.test(url) ? url : "";
  }

  /** Relative asset path or absolute https URL, nothing else. */
  function safeImage(value) {
    var src = String(value || "").trim();
    if (/^https?:\/\/\S+$/i.test(src)) return src;
    if (/^\.?\/[^\s"']*$/.test(src)) return src;
    return "";
  }

  /* ---------- roles ---------- */

  var ROLE_RANK = { viewer: 0, admin: 1, owner: 2 };
  var ROLE_LABEL = { owner: "Owner", admin: "Admin", viewer: "Viewer" };

  function roleRank(role) {
    return Object.prototype.hasOwnProperty.call(ROLE_RANK, role) ? ROLE_RANK[role] : -1;
  }

  function can(role, required) {
    return roleRank(role) >= roleRank(required);
  }

  function roleLabel(role) {
    return ROLE_LABEL[role] || "Unknown";
  }

  /* ---------- formatting ---------- */

  function initials(value) {
    var text = String(value || "").trim();
    if (!text) return "--";
    if (text.indexOf("@") > 0) text = text.slice(0, text.indexOf("@"));
    var parts = text.split(/[._\-\s]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return text.slice(0, 2).toUpperCase();
  }

  /** SQLite stores UTC without a zone marker; append one before parsing. */
  function parseStamp(value) {
    var text = String(value || "").trim();
    if (!text) return null;
    var iso = text.indexOf("T") > 0 ? text : text.replace(" ", "T");
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) iso += "Z";
    var date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function relativeTime(value, now) {
    var date = parseStamp(value);
    if (!date) return "--";
    var seconds = Math.round(((now ? now.getTime() : Date.now()) - date.getTime()) / 1000);
    if (seconds < 0) seconds = 0;
    if (seconds < 45) return "just now";

    var STEPS = [
      [60, "s"], [3600, "m"], [86400, "h"], [604800, "d"], [2592000, "w"], [31536000, "mo"]
    ];
    var DIVISORS = [1, 60, 3600, 86400, 604800, 2592000];
    for (var i = 0; i < STEPS.length; i++) {
      if (seconds < STEPS[i][0]) {
        return Math.floor(seconds / DIVISORS[i]) + STEPS[i][1] + " ago";
      }
    }
    return Math.floor(seconds / 31536000) + "y ago";
  }

  function absoluteTime(value) {
    var date = parseStamp(value);
    if (!date) return "--";
    return date.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  }

  /* ---------- audit ---------- */

  var ACTION_GROUPS = [
    { value: "", label: "All activity" },
    { value: "project.", label: "Projects" },
    { value: "media.", label: "Media" },
    { value: "admin.", label: "Roster" },
    { value: "session.", label: "Sessions" },
    { value: "auth.", label: "Sign-in" }
  ];

  function actionLabel(action) {
    return String(action || "")
      .split(".")
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(" · ");
  }

  /** Serialises filter state into a query string, dropping empty values. */
  function buildQuery(filters) {
    var params = new URLSearchParams();
    Object.keys(filters || {}).forEach(function (key) {
      var value = filters[key];
      if (value === null || value === undefined || value === "") return;
      params.set(key, String(value));
    });
    var query = params.toString();
    return query ? "?" + query : "";
  }

  function csvCell(value) {
    if (value === null || value === undefined) return "";
    var text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  /** Rows: array of objects. Columns: array of keys. */
  function toCsv(columns, rows) {
    var lines = [columns.join(",")];
    (rows || []).forEach(function (row) {
      lines.push(columns.map(function (key) { return csvCell(row[key]); }).join(","));
    });
    return lines.join("\r\n");
  }

  /** Which sprite glyph represents a session's device. */
  function deviceIcon(device) {
    const label = String(device || "");
    if (label.startsWith("Mobile")) return "#i-mobile";
    if (label.startsWith("Tablet")) return "#i-mobile";
    return "#i-monitor";
  }

  /** Which sprite glyph represents a role. */
  function roleIcon(role) {
    if (role === "owner") return "#i-shield";
    if (role === "admin") return "#i-key";
    return "#i-users";
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + " B";
    if (value < 1048576) return (value / 1024).toFixed(1) + " KB";
    return (value / 1048576).toFixed(1) + " MB";
  }

  globalScope.LuminaAdmin = {
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    safeImage: safeImage,
    can: can,
    roleRank: roleRank,
    roleLabel: roleLabel,
    initials: initials,
    parseStamp: parseStamp,
    relativeTime: relativeTime,
    absoluteTime: absoluteTime,
    ACTION_GROUPS: ACTION_GROUPS,
    actionLabel: actionLabel,
    deviceIcon: deviceIcon,
    roleIcon: roleIcon,
    buildQuery: buildQuery,
    toCsv: toCsv,
    formatBytes: formatBytes
  };
})(typeof window !== "undefined" ? window : globalThis);
