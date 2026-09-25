/**
 * Tests for the chat proxy's D1 wiring.
 * Run: node tests/chat.test.mjs
 *
 * Lumi's PROJECTS section used to be a hardcoded string duplicated in two files.
 * These tests prove the production handler now builds it from the database, by
 * intercepting the OpenRouter request and inspecting the system message.
 *
 * Order matters: chat.js memoises the prompt for 60s, so the first call in this
 * file fixes what every later call sees.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeD1, seededDatabase } from "./helpers/d1-sqlite.mjs";
import { onRequestPost } from "../functions/api/chat.js";

const sqlite = seededDatabase();

let captured = null;
function stubOpenRouter() {
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), headers: init.headers, payload: JSON.parse(init.body) };
    return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
  };
}

function chatRequest(messages, extra = {}) {
  return new Request("https://lumina-frameworks.com/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...extra })
  });
}

stubOpenRouter();

const env = {
  DB: makeD1(sqlite),
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_MODEL: "test/model",
  OPENROUTER_REASONING: "medium",
  SITE_URL: "https://lumina-frameworks.com"
};

describe("POST /api/chat", () => {
  test("builds the system prompt from D1, not the hardcoded fallback", async () => {
    // 'Local Forge' exists in db/seed.sql but in none of the old hardcoded lists,
    // so its presence proves the database was the source.
    const response = await onRequestPost({
      request: chatRequest([{ role: "user", content: "What have you built?" }]),
      env
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /text\/event-stream/);

    assert.ok(captured, "OpenRouter was called");
    const system = captured.payload.messages[0];
    assert.equal(system.role, "system");
    assert.match(system.content, /Local Forge/, "D1-only project is present");
    assert.match(
      system.content,
      /Academic writing platform with custom-tuned LLMs/,
      "uses the fuller D1 description, not the short fallback one"
    );
    assert.match(system.content, /PC BUILD COACH/, "carousel taglines survive into the prompt");
  });

  test("sends the model, reasoning effort and bearer token from env", async () => {
    await onRequestPost({
      request: chatRequest([{ role: "user", content: "hi" }]),
      env
    });
    assert.equal(captured.payload.model, "test/model");
    assert.equal(captured.payload.reasoning.effort, "medium");
    assert.equal(captured.payload.stream, true);
    assert.equal(captured.headers.Authorization, "Bearer test-key");
    assert.equal(captured.url, "https://openrouter.ai/api/v1/chat/completions");
  });

  test("passes conversation history through after the system message", async () => {
    await onRequestPost({
      request: chatRequest([
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" }
      ]),
      env
    });
    const roles = captured.payload.messages.map((m) => m.role);
    assert.deepEqual(roles, ["system", "user", "assistant", "user"]);
    assert.equal(captured.payload.messages[3].content, "second");
  });

  test("rejects a request with no user message", async () => {
    const response = await onRequestPost({
      request: chatRequest([{ role: "assistant", content: "unsolicited" }]),
      env
    });
    assert.equal(response.status, 400);
  });

  test("rejects an empty message list", async () => {
    const response = await onRequestPost({ request: chatRequest([]), env });
    assert.equal(response.status, 400);
  });

  test("rejects a malformed body", async () => {
    const response = await onRequestPost({
      request: new Request("https://lumina-frameworks.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json"
      }),
      env
    });
    assert.equal(response.status, 400);
  });

  test("reports a missing API key instead of calling upstream", async () => {
    const response = await onRequestPost({
      request: chatRequest([{ role: "user", content: "hi" }]),
      env: { ...env, OPENROUTER_API_KEY: undefined }
    });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /OPENROUTER_API_KEY/);
  });

  test("still answers when the DB binding is missing", async () => {
    // Fresh module instance: the memoised prompt from above would mask this.
    stubOpenRouter();
    const { onRequestPost: freshChat } = await import("../functions/api/chat.js?v=no-db");
    const response = await freshChat({
      request: chatRequest([{ role: "user", content: "hi" }]),
      env: { ...env, DB: undefined }
    });
    assert.equal(response.status, 200);
    assert.doesNotMatch(captured.payload.messages[0].content, /Local Forge/);
    assert.match(captured.payload.messages[0].content, /A\.K\.A\.R\.I\./, "falls back to the built-in list");
  });

  test("surfaces an upstream failure as a 502", async () => {
    globalThis.fetch = async () => new Response("upstream exploded", { status: 500 });
    const { onRequestPost: freshChat } = await import("../functions/api/chat.js?v=upstream");
    const response = await freshChat({
      request: chatRequest([{ role: "user", content: "hi" }]),
      env
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.status, 500);
    assert.match(body.detail, /upstream exploded/);
  });
});
