/**
 * Shared project helpers: D1 access, row mapping, and validation.
 * Used by the public /api/projects route, the admin CRUD routes, and Lumi's
 * system prompt builder.
 */

export const CATEGORY_MAX = 40;
export const STACK_MAX_ITEMS = 6;
export const TAGS_MAX_ITEMS = 12;

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

/** D1 row -> the shape the front end already consumes. */
export function rowToProject(row) {
  return {
    id: row.slug,
    slug: row.slug,
    title: row.title,
    symbol: row.symbol,
    category: row.category,
    year: Number(row.year),
    image: row.image_url || null,
    blurb: row.blurb,
    tagline: row.tagline || null,
    stack: parseJsonArray(row.stack),
    tags: parseJsonArray(row.tags),
    url: row.url || null,
    featured: Number(row.featured) === 1,
    published: Number(row.published) === 1,
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const SELECT_COLUMNS =
  "slug, title, symbol, category, year, image_url, blurb, tagline, stack, tags, url, featured, published, sort_order, created_at, updated_at";

export async function listProjects(env, { featured = null, includeUnpublished = false } = {}) {
  const clauses = [];
  const bindings = [];

  if (!includeUnpublished) clauses.push("published = 1");
  if (featured !== null) {
    clauses.push("featured = ?");
    bindings.push(featured ? 1 : 0);
  }

  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT ${SELECT_COLUMNS} FROM projects${where} ORDER BY sort_order ASC, year DESC, title ASC`;

  const { results } = await env.DB.prepare(sql)
    .bind(...bindings)
    .all();

  return (results || []).map(rowToProject);
}

export async function getProject(env, slug) {
  const row = await env.DB.prepare(
    `SELECT ${SELECT_COLUMNS} FROM projects WHERE slug = ?`
  )
    .bind(slug)
    .first();
  return row ? rowToProject(row) : null;
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function cleanString(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

/**
 * Validates and normalises an admin payload. The admin form always submits the
 * full object, so every field is required (PUT is a full replace).
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function validateProjectInput(body = {}) {
  const errors = [];
  const input = body && typeof body === "object" ? body : {};

  const title = cleanString(input.title, 120);
  const symbol = cleanString(input.symbol, 4).toUpperCase();
  const category = cleanString(input.category, CATEGORY_MAX);
  const blurb = cleanString(input.blurb, 600);
  // Carousel label, e.g. "ACADEMIC WRITING PLATFORM". Optional.
  const tagline = cleanString(input.tagline, 60).toUpperCase() || null;
  const year = Number.parseInt(input.year, 10);

  if (!title) errors.push("Title is required.");
  if (!symbol) errors.push("Symbol is required.");
  else if (!/^[A-Z0-9]{1,4}$/.test(symbol)) {
    errors.push("Symbol must be 1-4 letters or digits.");
  }
  if (!category) errors.push("Category is required.");
  if (!blurb) errors.push("Blurb is required.");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    errors.push("Year must be between 2000 and 2100.");
  }

  const stack = parseJsonArray(input.stack)
    .map((s) => cleanString(s, 40))
    .filter(Boolean)
    .slice(0, STACK_MAX_ITEMS);
  const tags = parseJsonArray(input.tags)
    .map((s) => cleanString(s, 30).toLowerCase())
    .filter(Boolean)
    .slice(0, TAGS_MAX_ITEMS);

  // Only http(s) links, or empty. Blocks javascript: and data: URLs.
  const rawUrl = cleanString(input.url, 500);
  let url = null;
  if (rawUrl) {
    if (/^https?:\/\/\S+$/i.test(rawUrl)) url = rawUrl;
    else errors.push("Project URL must start with http:// or https://");
  }

  // Relative asset path or an https URL. Same reasoning as above.
  const rawImage = cleanString(input.image_url ?? input.image, 500);
  let image_url = null;
  if (rawImage) {
    if (/^https?:\/\/\S+$/i.test(rawImage) || /^\.?\/[^\s]*$/.test(rawImage)) {
      image_url = rawImage;
    } else {
      errors.push("Image must be a relative path or an https:// URL.");
    }
  }

  const sortOrderRaw = Number.parseInt(input.sort_order ?? input.sortOrder, 10);
  const sort_order = Number.isInteger(sortOrderRaw) ? sortOrderRaw : 0;

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title,
      symbol,
      category,
      year,
      blurb,
      tagline,
      stack: JSON.stringify(stack),
      tags: JSON.stringify(tags),
      url,
      image_url,
      featured: input.featured ? 1 : 0,
      published: input.published === undefined ? 1 : input.published ? 1 : 0,
      sort_order
    }
  };
}
