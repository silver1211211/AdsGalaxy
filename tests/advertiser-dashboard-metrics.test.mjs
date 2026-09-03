import assert from "node:assert/strict";
import test from "node:test";

const { selectAdvertiserDashboardMetric } = await import(
  new URL("../src/lib/advertiserDashboardMetrics.ts", import.meta.url)
);

test("channel click campaigns display their click count", () => {
  assert.deepEqual(
    selectAdvertiserDashboardMetric({ type: "clicks", clicks: 1079, conversions: 0 }),
    { value: 1079, label: "Clicks" },
  );
});

test("channel view campaigns use clicks and support the singular label", () => {
  assert.deepEqual(
    selectAdvertiserDashboardMetric({ type: "views", clicks: 3, conversions: 11 }),
    { value: 3, label: "Clicks" },
  );
  assert.deepEqual(
    selectAdvertiserDashboardMetric({ type: "views", clicks: 1, conversions: 11 }),
    { value: 1, label: "Click" },
  );
});

test("Mini App campaigns display attributed conversions with singular support", () => {
  assert.deepEqual(
    selectAdvertiserDashboardMetric({ type: "miniapp", clicks: 59, conversions: 2 }),
    { value: 2, label: "Conversions" },
  );
  assert.deepEqual(
    selectAdvertiserDashboardMetric({ type: "miniapp", clicks: 59, conversions: 1 }),
    { value: 1, label: "Conversion" },
  );
});

test("selected channel and Mini App metrics never fall back across semantics", () => {
  assert.deepEqual(
    selectAdvertiserDashboardMetric({ type: "miniapp", clicks: 59, conversions: 0 }),
    { value: 0, label: "Conversions" },
  );
  assert.deepEqual(
    selectAdvertiserDashboardMetric({ type: "clicks", clicks: 0, conversions: 8 }),
    { value: 0, label: "Clicks" },
  );
});

test("null, undefined, and invalid selected values display semantic zeroes", () => {
  for (const clicks of [null, undefined, Number.NaN, "invalid"]) {
    assert.deepEqual(
      selectAdvertiserDashboardMetric({ type: "clicks", clicks, conversions: 8 }),
      { value: 0, label: "Clicks" },
    );
  }
  for (const conversions of [null, undefined, Number.NaN, "invalid"]) {
    assert.deepEqual(
      selectAdvertiserDashboardMetric({ type: "miniapp", clicks: 59, conversions }),
      { value: 0, label: "Conversions" },
    );
  }
});

test("broadcast and unknown types preserve existing conversion behavior", () => {
  assert.deepEqual(
    selectAdvertiserDashboardMetric({ type: "broadcast", clicks: 7, conversions: 1 }),
    { value: 1, label: "Conversions" },
  );
  assert.deepEqual(
    selectAdvertiserDashboardMetric({ type: "future-type", clicks: 7, conversions: 2 }),
    { value: 2, label: "Conversions" },
  );
});
