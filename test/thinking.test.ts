import assert from "node:assert/strict";
import { test } from "node:test";
import { getSupportedThinkingLevels, type Api, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";
import registerProvider from "../extension.ts";
import { streamKiro } from "../src/kiro/stream.ts";

const schema = (efforts: string[], disabled = true) => ({
  properties: {
    thinking: { properties: { type: { enum: disabled ? ["adaptive", "disabled"] : ["adaptive"] } } },
    output_config: { properties: { effort: { enum: efforts } } },
  },
});

test("discovered native effort levels reach Pi and the Kiro request without prompt tags", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ models: [
    { modelId: "claude-opus-5.5", additionalModelRequestFieldsSchema: schema(["low", "medium", "high", "xhigh", "max"], false) },
    { modelId: "claude-opus-4.6", additionalModelRequestFieldsSchema: schema(["low", "medium", "high", "max"]) },
    { modelId: "claude-opus-4.5" },
  ] }));
  const oldKey = process.env.KIRO_API_KEY;
  process.env.KIRO_API_KEY = "test-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.KIRO_API_KEY;
    else process.env.KIRO_API_KEY = oldKey;
  });
  let models: Model<Api>[] = [];
  await registerProvider({ registerProvider: (_id, config) => {
    models = (config as { models: Model<Api>[] }).models;
  } });
  const [opus, older, legacy] = models;
  assert.deepEqual(opus.thinkingLevelMap, { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" });
  // Older Pi peers do not know the max UI level yet; the map still carries it.
  assert.ok(getSupportedThinkingLevels(opus).includes("xhigh"));
  assert.ok(!getSupportedThinkingLevels(opus).includes("off"));
  assert.equal(older.thinkingLevelMap?.xhigh, null);
  assert.equal(older.thinkingLevelMap?.max, "max");
  assert.ok(!getSupportedThinkingLevels(older).includes("xhigh"));
  assert.equal(legacy.thinkingLevelMap, undefined);
  assert.deepEqual(models.find(m => m.id === "claude-opus-4-6-1m")?.thinkingLevelMap, older.thinkingLevelMap);

  const requests: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return new Response('{"content":"OK"}{"contextUsagePercentage":1}');
  });
  const context = { messages: [{ role: "user" as const, content: "Reply OK", timestamp: 0 }] };
  for (const reasoning of ["minimal", "low", "medium", "high", "xhigh", "max"] as ThinkingLevel[]) {
    const result = await streamKiro(opus, context, { reasoning }).result();
    assert.equal(result.stopReason, "stop");
    assert.deepEqual(requests.at(-1).additionalModelRequestFields, {
      thinking: { type: "adaptive" },
      output_config: { effort: reasoning === "minimal" ? "low" : reasoning },
    });
    assert.doesNotMatch(requests.at(-1).conversationState.currentMessage.userInputMessage.content, /thinking_mode|max_thinking_length/);
  }
  await streamKiro(older, context).result();
  assert.deepEqual(requests.at(-1).additionalModelRequestFields, { thinking: { type: "disabled" } });
  await streamKiro(opus, context).result();
  assert.deepEqual(requests.at(-1).additionalModelRequestFields, { thinking: { type: "adaptive" } });
  const count = requests.length;
  assert.equal((await streamKiro(older, context, { reasoning: "xhigh" }).result()).stopReason, "error");
  assert.equal(requests.length, count);
  await streamKiro(legacy, context, { reasoning: "high" }).result();
  assert.equal(requests.at(-1).additionalModelRequestFields, undefined);
  assert.match(requests.at(-1).conversationState.currentMessage.userInputMessage.content, /<max_thinking_length>30000/);
});
