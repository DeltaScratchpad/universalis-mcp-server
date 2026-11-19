import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JOBS, resolveJob, resolveStatName } from "../data/jobs.js";
import { BaseOutputSchema, ResponseFormatSchema } from "../schemas/common.js";
import type { ClientBundle } from "../services/clients.js";
import {
  type FoodCandidate,
  mergeSnapshots,
  parseItemFoodRow,
  parseMealSearchRow,
  parseUniversalisCurrent,
  rankFoods,
} from "../services/food.js";
import { chunkArray } from "../utils/array.js";
import { buildToolResponse } from "../utils/format.js";

const MEALS_SEARCH_CATEGORY = 45;
const MEAL_FIELDS = "Name,LevelItem@as(raw),ItemAction.Data,CanBeHq";
const ITEM_FOOD_FIELDS = "BaseParam[].Name,Value,Max,ValueHQ,MaxHQ,IsRelative";

export function registerFoodTools(server: McpServer, clients: ClientBundle) {
  server.registerTool(
    "ffxiv_rank_food_value",
    {
      title: "Rank Food by Gil per Relevant Stat",
      description:
        "Find the most cost-effective meals for a job. Takes the top N meals by the job's relevant " +
        "capped stats (e.g. Crit/DH/Det for BRD; Vitality ignored), prices them from live market " +
        "board listings across one or more worlds/DCs/regions (default EU: Chaos + Light), and " +
        "ranks them by gil per relevant stat point. Accepts job abbreviations (BRD), names (Bard) " +
        "or base classes (Archer).",
      inputSchema: z
        .object({
          job: z
            .string()
            .min(2)
            .describe(
              'Job abbreviation, job name, or base class. Examples: "BRD", "Samurai", "Archer".',
            ),
          stats: z
            .array(z.string().min(2))
            .min(1)
            .optional()
            .describe(
              'Override the job\'s relevant stats. Accepts names or shorthand: "crit", "dh", "det", "sks", "sps", "ten", "pie".',
            ),
          stat_weights: z
            .record(z.string(), z.number().min(0))
            .optional()
            .describe(
              'Optional per-stat weights, e.g. {"crit": 1.2, "dh": 1, "det": 0.9}. Default 1 each.',
            ),
          world_dc_region: z
            .array(z.string().min(2))
            .min(1)
            .max(6)
            .default(["Chaos", "Light"])
            .describe(
              'Worlds, data centers or regions to buy from. Default ["Chaos", "Light"] (EU).',
            ),
          top_n: z
            .number()
            .int()
            .min(1)
            .max(20)
            .default(5)
            .describe("How many of the highest-stat meals to compare (default 5)."),
          quantity: z
            .number()
            .int()
            .min(1)
            .max(999)
            .default(10)
            .describe(
              "Units you plan to buy; price is averaged over the cheapest listings that fill it.",
            ),
          variant: z
            .enum(["best", "hq", "nq"])
            .default("best")
            .describe(
              '"best" compares HQ and NQ per meal and keeps the better gil/point; or force "hq"/"nq".',
            ),
          min_item_level: z
            .number()
            .int()
            .min(1)
            .default(600)
            .describe("Only consider meals at or above this item level (default 600)."),
          min_velocity: z
            .number()
            .min(0)
            .optional()
            .describe("Flag meals selling fewer than this many units/day across the scopes."),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      outputSchema: BaseOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      job,
      stats,
      stat_weights,
      world_dc_region,
      top_n,
      quantity,
      variant,
      min_item_level,
      min_velocity,
      response_format,
    }) => {
      const jobInfo = resolveJob(job);
      if (!jobInfo && !stats) {
        const known = JOBS.map((j) => j.abbr).join(", ");
        throw new Error(`Unknown job '${job}'. Known jobs: ${known}. Or pass 'stats' explicitly.`);
      }

      const statNames = (stats ?? jobInfo?.stats ?? []).map((s) => {
        const resolved = resolveStatName(s) ?? (jobInfo?.stats.includes(s) ? s : undefined);
        if (!resolved) throw new Error(`Unknown stat '${s}'.`);
        return resolved;
      });
      const weights: Record<string, number> = Object.fromEntries(statNames.map((s) => [s, 1]));
      for (const [key, value] of Object.entries(stat_weights ?? {})) {
        const resolved = resolveStatName(key);
        if (!resolved) throw new Error(`Unknown stat in stat_weights: '${key}'.`);
        weights[resolved] = value;
      }

      // 1. Every meal at or above the item level floor.
      const rows = await clients.xivapi.searchAll({
        sheets: "Item",
        query: `ItemSearchCategory=${MEALS_SEARCH_CATEGORY} LevelItem>=${min_item_level}`,
        fields: MEAL_FIELDS,
        limit: 100,
      });
      const meals = rows.map(parseMealSearchRow).filter((m) => m != null);

      // 2. Their stats from the ItemFood sheet.
      const foodIds = Array.from(new Set(meals.map((m) => m.itemFoodId)));
      const foodStats = new Map<number, ReturnType<typeof parseItemFoodRow>>();
      for (const chunk of chunkArray(foodIds, 100)) {
        const data = await clients.xivapi.getSheetRows("ItemFood", {
          rows: chunk.join(","),
          fields: ITEM_FOOD_FIELDS,
        });
        const sheetRows = Array.isArray(data.rows) ? data.rows : [];
        for (const row of sheetRows) {
          const id = (row as { row_id?: unknown }).row_id;
          if (typeof id === "number") foodStats.set(id, parseItemFoodRow(row));
        }
      }

      const candidates: FoodCandidate[] = meals.map((m) => ({
        itemId: m.itemId,
        name: m.name,
        itemLevel: m.itemLevel,
        canBeHq: m.canBeHq,
        stats: foodStats.get(m.itemFoodId) ?? [],
      }));

      // 3. Pre-rank by stats so we only price the top N.
      const preRanked = rankFoods(candidates, new Map(), {
        weights,
        topN: top_n,
        quantity,
        variant,
      });
      const topIds = preRanked.rows.map((r) => r.item_id);

      // 4. Live listings for each scope, merged.
      const snapshots = [];
      const scopeErrors: Record<string, string> = {};
      for (const scope of world_dc_region) {
        try {
          const payload = await clients.universalis.getCurrentMarketData(scope, topIds, {
            listings: 50,
            entries: 20,
          });
          snapshots.push(parseUniversalisCurrent(payload, scope));
        } catch (error) {
          scopeErrors[scope] = error instanceof Error ? error.message : String(error);
        }
      }
      const market = mergeSnapshots(snapshots);

      const ranked = rankFoods(candidates, market, {
        weights,
        topN: top_n,
        quantity,
        variant,
        minVelocity: min_velocity,
      });

      const summaryLines = ranked.rows.slice(0, 3).map((r, i) => {
        const price =
          r.avg_unit_price != null
            ? `${r.avg_unit_price.toLocaleString("en-GB")} gil`
            : "no listings";
        const gpp = r.gil_per_point != null ? `${r.gil_per_point} gil/pt` : "n/a";
        return `${i + 1}. ${r.name} ${r.variant.toUpperCase()} (i${r.item_level}): ${gpp}, ${price}, ${r.pct_of_best_stats}% of top stats, cheapest on ${r.cheapest_world ?? "n/a"}`;
      });

      return buildToolResponse({
        title: `Food value for ${jobInfo ? `${jobInfo.name} (${jobInfo.abbr})` : job}`,
        responseFormat: response_format,
        data: { ranked: ranked.rows },
        summaryLines,
        meta: {
          job: jobInfo?.abbr ?? null,
          relevant_stats: weights,
          scopes: world_dc_region,
          quantity,
          variant,
          min_item_level,
          meals_considered: ranked.consideredCount,
          compared: ranked.rows.length,
          price_note: "Listing prices exclude the 5% market tax.",
          ...(Object.keys(scopeErrors).length ? { scope_errors: scopeErrors } : {}),
        },
      });
    },
  );
}
