// Runs against the compiled build: `pnpm build && node --test tests/`
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveJob, resolveStatName } from "../dist/data/jobs.js";
import { fillOrder, parseItemFoodRow, rankFoods } from "../dist/services/food.js";
import { registerFoodTools } from "../dist/tools/food.js";

// --- Fixtures shaped like real XIVAPI v2 / Universalis v2 responses ----------

const meal = (id, name, ilvl, foodId) => ({
  score: 1,
  sheet: "Item",
  row_id: id,
  fields: {
    Name: name,
    LevelItem: ilvl,
    CanBeHq: true,
    ItemAction: { value: 1, sheet: "ItemAction", row_id: 1, fields: { Data: [48, foodId, 1800, 0, 0, 0, 0, 0, 0] } },
  },
});

const bp = (name) => ({ value: 1, sheet: "BaseParam", row_id: 1, fields: { Name: name } });
const food = (id, names, max, maxHq) => ({
  row_id: id,
  fields: {
    BaseParam: names.map(bp),
    Value: [8, 8, 8],
    Max: max,
    ValueHQ: [10, 10, 10],
    MaxHQ: maxHq,
    IsRelative: [true, true, true],
  },
});

const SEARCH_RESULTS = [
  meal(46000, "Paes de Queijo", 740, 676),
  meal(46001, "Bubble Tea", 740, 677),
  meal(46002, "Sweet Maple Mate", 740, 678),
  meal(46003, "Mate Cookie", 740, 679),
  meal(49239, "Nachos", 770, 701),
  meal(49240, "Fixture BiS Stew", 770, 702),
];

// 676-679 and 701 are real ItemFood rows; 702 is a fictional "current BiS" Crit/Det meal.
const ITEM_FOOD = [
  food(676, ["Direct Hit Rate", "Vitality", "Determination"], [113, 196, 68], [142, 246, 85]),
  food(677, ["Skill Speed", "Vitality", "Direct Hit Rate"], [113, 196, 68], [142, 246, 85]),
  food(678, ["Critical Hit", "Vitality", "Skill Speed"], [113, 196, 68], [142, 246, 85]),
  food(679, ["Determination", "Vitality", "Critical Hit"], [113, 196, 68], [142, 246, 85]),
  food(701, ["Critical Hit", "Vitality", "Skill Speed"], [120, 237, 72], [151, 297, 91]),
  food(702, ["Critical Hit", "Vitality", "Determination"], [120, 237, 72], [151, 297, 91]),
];

const L = (worldName, pricePerUnit, quantity, hq = true) => ({ worldName, pricePerUnit, quantity, hq, total: pricePerUnit * quantity });
const UNIVERSALIS = {
  Chaos: {
    49240: [L("Cerberus", 12000, 5), L("Ragnarok", 12500, 20)],
    46003: [L("Moogle", 2813, 99), L("Moogle", 3699, 99)],
    46000: [L("Cerberus", 4500, 18), L("Ragnarok", 4990, 24), L("Omega", 3000, 40, false)],
  },
  Light: {
    49240: [L("Odin", 11000, 3)],
    46003: [L("Zodiark", 2600, 4), L("Lich", 2700, 50)],
  },
};

function mockClients(calls) {
  return {
    xivapi: {
      async searchAll(params) {
        calls.search = params;
        return SEARCH_RESULTS;
      },
      async getSheetRows(sheet, params) {
        calls.sheet = { sheet, params };
        const ids = params.rows.split(",").map(Number);
        return { rows: ITEM_FOOD.filter((r) => ids.includes(r.row_id)) };
      },
    },
    universalis: {
      async getCurrentMarketData(scope, ids, query) {
        (calls.universalis ??= []).push({ scope, ids, query });
        const byItem = UNIVERSALIS[scope] ?? {};
        const items = Object.fromEntries(
          ids.map((id) => [id, { itemID: id, listings: byItem[id] ?? [], hqSaleVelocity: 3, nqSaleVelocity: 1, lastUploadTime: 1 }]),
        );
        return { itemIDs: ids, items, dcName: scope, unresolvedItems: [] };
      },
    },
  };
}

function captureTool(clients) {
  const tools = {};
  registerFoodTools({ registerTool: (name, _cfg, handler) => (tools[name] = handler) }, clients);
  return tools.ffxiv_rank_food_value;
}

// --- Tests ------------------------------------------------------------------

test("job lookup accepts abbreviations, names and base classes", () => {
  assert.equal(resolveJob("brd").abbr, "BRD");
  assert.equal(resolveJob("Bard").abbr, "BRD");
  assert.equal(resolveJob("archer").abbr, "BRD");
  assert.equal(resolveJob("Samurai").abbr, "SAM");
  assert.equal(resolveJob("RPR").name, "Reaper");
  assert.equal(resolveJob("nope"), undefined);
  assert.equal(resolveStatName("dh"), "Direct Hit Rate");
});

test("ItemFood rows use the caps for relative stats", () => {
  const stats = parseItemFoodRow(ITEM_FOOD[0]);
  assert.deepEqual(stats.find((s) => s.name === "Direct Hit Rate"), { name: "Direct Hit Rate", nq: 113, hq: 142 });
});

test("fillOrder averages whole listings across worlds", () => {
  const fill = fillOrder(
    [
      { pricePerUnit: 100, quantity: 4, hq: true, worldName: "A", scope: "Light" },
      { pricePerUnit: 200, quantity: 10, hq: true, worldName: "B", scope: "Chaos" },
    ],
    10,
  );
  assert.equal(fill.avgUnitPrice, Math.round((400 + 2000) / 14));
  assert.equal(fill.cheapestWorld, "A (Light)");
  assert.equal(fill.filled, true);
});

test("Bard: previous-tier Crit/Det food beats premium BiS on gil per point", async () => {
  const calls = {};
  const tool = captureTool(mockClients(calls));
  const res = await tool({
    job: "Bard",
    world_dc_region: ["Chaos", "Light"],
    top_n: 4,
    quantity: 10,
    variant: "best",
    min_item_level: 600,
    response_format: "json",
  });
  const { ranked } = res.structuredContent.data;
  const meta = res.structuredContent.meta;

  assert.match(calls.search.query, /ItemSearchCategory=45 LevelItem>=600/);
  assert.deepEqual(calls.universalis.map((c) => c.scope), ["Chaos", "Light"]);
  assert.deepEqual(Object.keys(meta.relevant_stats).sort(), ["Critical Hit", "Determination", "Direct Hit Rate"]);

  // Top 4 by BRD stats: BiS (242), Paes (227), Mate Cookie (227), Nachos/Sweet Maple (151/142 crit only).
  assert.equal(ranked.length, 4);
  assert.equal(ranked[0].name, "Mate Cookie");
  assert.equal(ranked[0].variant, "hq");
  assert.equal(ranked[0].cheapest_world, "Zodiark (Light)");
  assert.ok(ranked[0].pct_of_best_stats > 90);
  const bis = ranked.find((r) => r.name === "Fixture BiS Stew");
  assert.ok(bis.gil_per_point > ranked[0].gil_per_point * 3);
  // Vitality never counts
  assert.ok(ranked.every((r) => r.contributing_stats.every((s) => s.stat !== "Vitality")));
  // Nachos has no listings → sorted last, flagged
  const last = ranked.at(-1);
  assert.equal(last.gil_per_point, null);
  assert.ok(last.notes.some((n) => n.includes("No listings")));
});

test("stat override and unknown job errors", async () => {
  const tool = captureTool(mockClients({}));
  const res = await tool({
    job: "whatever",
    stats: ["crit"],
    world_dc_region: ["Chaos"],
    top_n: 2,
    quantity: 1,
    variant: "hq",
    min_item_level: 600,
    response_format: "json",
  });
  assert.deepEqual(Object.keys(res.structuredContent.meta.relevant_stats), ["Critical Hit"]);
  await assert.rejects(
    tool({ job: "whatever", world_dc_region: ["Chaos"], top_n: 2, quantity: 1, variant: "hq", min_item_level: 600, response_format: "json" }),
    /Unknown job/,
  );
});

test("rankFoods ignores meals with no relevant stats", () => {
  const { consideredCount } = rankFoods(
    [{ itemId: 1, name: "Crafter food", itemLevel: 750, canBeHq: true, stats: [{ name: "CP", nq: 80, hq: 100 }] }],
    new Map(),
    { weights: { "Critical Hit": 1 }, topN: 5, quantity: 1, variant: "best" },
  );
  assert.equal(consideredCount, 0);
});
