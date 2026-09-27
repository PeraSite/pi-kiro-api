import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHistory, splitSystemMessages } from "../src/kiro/transform.ts";

test("system messages never become orphan tool results; tool and section updates survive", () => {
  const read = { name: "read", description: "Read", parameters: { type: "object" } };
  const bash = { name: "bash", description: "Run", parameters: { type: "object" } };
  const user = { role: "user", content: "hello", timestamp: 0 };
  const split = splitSystemMessages([
    { role: "system", content: "System prompt", sections: { policy: "old", gone: "remove me" }, toolsAdded: [read] },
    user,
    { role: "system", sections: { policy: "new", gone: null }, toolsAdded: [bash], toolsRemoved: [{ name: "read" }] },
  ] as any, undefined, undefined);
  assert.deepEqual(split.messages, [user]);
  assert.equal(split.systemPrompt, "System prompt\n\nnew");
  assert.deepEqual(split.tools, [bash]);
  assert.deepEqual(buildHistory(split.messages, "claude-opus-5-5", split.systemPrompt).history, []);
  assert.deepEqual(splitSystemMessages([user] as any, "legacy", [read] as any), {
    systemPrompt: "legacy", tools: [read], messages: [user],
  });
});
