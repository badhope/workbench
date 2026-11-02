import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8"
);
const publish = workflow.match(/^  publish:\s*\r?\n(?:(?!  \w+:).*(?:\r?\n|$))*/m)?.[0];
const condition = publish?.match(/^    if:\s*(.+)$/m)?.[1].trim();
const match = condition?.match(
  /^(?:github\.event_name\s*==\s*'([^']+)'\s*&&\s*)?startsWith\(github\.ref,\s*'([^']+)'\)$/
);

for (const [event, ref, expected] of [
  ["push", "refs/tags/v1.2.3", true],
  ["workflow_dispatch", "refs/tags/v1.2.3", false],
  ["push", "refs/heads/main", false],
  ["push", "refs/tags/release-1.2.3", false],
]) {
  test(`publish: ${event} ${ref}`, () => {
    assert.ok(match, `Unsupported or unsafe publish condition: ${condition}`);
    assert.equal(
      (!match[1] || event === match[1]) &&
        ref.toLowerCase().startsWith(match[2].toLowerCase()),
      expected
    );
  });
}
