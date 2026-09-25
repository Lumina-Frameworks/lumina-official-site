/**
 * Public projects feed.
 * GET /api/projects            -> all published projects
 * GET /api/projects?featured=1 -> published projects flagged for the home carousel
 *
 * Short browser cache so a newly published project shows up almost immediately.
 */
import { listProjects } from "../_shared/projects.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const featuredParam = url.searchParams.get("featured");
  const featured = featuredParam === null ? null : featuredParam === "1" || featuredParam === "true";

  try {
    const projects = await listProjects(env, { featured });
    return new Response(JSON.stringify({ projects }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Could not load projects.", detail: String(err?.message || err) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }
}
