/**
 * Pure logic for ranking FFXIV meals by gil per relevant stat point.
 * Kept free of I/O so it can be unit tested with recorded API shapes.
 */

export interface FoodStat {
  name: string;
  /** Stat points at the cap (what an endgame player actually gets). */
  nq: number;
  hq: number;
}

export interface FoodCandidate {
  itemId: number;
  name: string;
  itemLevel: number;
  canBeHq: boolean;
  stats: FoodStat[];
}

export interface MarketListing {
  pricePerUnit: number;
  quantity: number;
  hq: boolean;
  worldName: string;
  scope: string;
}

export interface MarketSnapshot {
  listings: MarketListing[];
  hqSaleVelocity: number;
  nqSaleVelocity: number;
  lastUploadTime: number | null;
}

export type Variant = "hq" | "nq";

/** Search result row from XIVAPI's Item sheet (fields: Name, LevelItem@as(raw), ItemAction.Data, CanBeHq). */
export function parseMealSearchRow(
  row: unknown,
): {
  itemId: number;
  name: string;
  itemLevel: number;
  canBeHq: boolean;
  itemFoodId: number;
} | null {
  if (!row || typeof row !== "object") return null;
  const r = row as { row_id?: unknown; fields?: Record<string, unknown> };
  const fields = r.fields ?? {};
  const itemId = typeof r.row_id === "number" ? r.row_id : null;
  const name = typeof fields.Name === "string" ? fields.Name : null;
  const levelRaw = fields.LevelItem;
  const itemLevel =
    typeof levelRaw === "number"
      ? levelRaw
      : levelRaw &&
          typeof levelRaw === "object" &&
          typeof (levelRaw as { value?: unknown }).value === "number"
        ? (levelRaw as { value: number }).value
        : 0;
  const action = fields.ItemAction as { fields?: { Data?: unknown } } | undefined;
  const data = action?.fields?.Data;
  // Meals: Data[0] = 48 (Well Fed status), Data[1] = ItemFood row, Data[2] = duration (s).
  const itemFoodId =
    Array.isArray(data) && data[0] === 48 && typeof data[1] === "number" ? data[1] : null;
  if (itemId == null || !name || itemFoodId == null || itemFoodId <= 0) return null;
  return { itemId, name, itemLevel, canBeHq: fields.CanBeHq === true, itemFoodId };
}

/** ItemFood sheet row (fields: BaseParam[].Name, Value, Max, ValueHQ, MaxHQ, IsRelative) → capped stats. */
export function parseItemFoodRow(row: unknown): FoodStat[] {
  if (!row || typeof row !== "object") return [];
  const fields = ((row as { fields?: Record<string, unknown> }).fields ?? {}) as Record<
    string,
    unknown
  >;
  const params = Array.isArray(fields.BaseParam) ? fields.BaseParam : [];
  const arr = (key: string) => (Array.isArray(fields[key]) ? (fields[key] as unknown[]) : []);
  const value = arr("Value");
  const max = arr("Max");
  const valueHq = arr("ValueHQ");
  const maxHq = arr("MaxHQ");
  const relative = arr("IsRelative");

  const stats: FoodStat[] = [];
  params.forEach((param, i) => {
    const name = (param as { fields?: { Name?: unknown } })?.fields?.Name;
    if (typeof name !== "string" || !name) return;
    const isRelative = relative[i] === true;
    // Relative stats (e.g. +10%) are limited by Max; at endgame you always hit the cap.
    // Flat stats (older meals) just give Value.
    const nq = Number(isRelative ? max[i] : value[i]) || 0;
    const hq = Number(isRelative ? maxHq[i] : valueHq[i]) || 0;
    if (nq <= 0 && hq <= 0) return;
    stats.push({ name, nq, hq });
  });
  return stats;
}

export function scoreFood(stats: FoodStat[], weights: Record<string, number>, variant: Variant) {
  let score = 0;
  const contributing: Array<{ stat: string; points: number }> = [];
  for (const stat of stats) {
    const weight = weights[stat.name] ?? 0;
    if (weight <= 0) continue;
    const points = variant === "hq" ? stat.hq : stat.nq;
    if (points <= 0) continue;
    score += points * weight;
    contributing.push({ stat: stat.name, points });
  }
  return { score, contributing };
}

/**
 * Cost of buying `quantity` units from the cheapest listings.
 * Partial stacks can't be bought on the market board, so whole listings are taken.
 */
export function fillOrder(listings: MarketListing[], quantity: number) {
  const sorted = [...listings].sort((a, b) => a.pricePerUnit - b.pricePerUnit);
  let units = 0;
  let total = 0;
  const used: MarketListing[] = [];
  for (const listing of sorted) {
    if (units >= quantity) break;
    used.push(listing);
    units += listing.quantity;
    total += listing.pricePerUnit * listing.quantity;
  }
  if (used.length === 0) return null;
  const worlds = Array.from(new Set(used.map((l) => `${l.worldName} (${l.scope})`)));
  return {
    cheapestUnitPrice: sorted[0].pricePerUnit,
    cheapestWorld: `${sorted[0].worldName} (${sorted[0].scope})`,
    avgUnitPrice: Math.round(total / units),
    unitsBought: units,
    filled: units >= quantity,
    worlds,
  };
}

export interface RankOptions {
  weights: Record<string, number>;
  topN: number;
  quantity: number;
  variant: "best" | Variant;
  minVelocity?: number;
}

export function rankFoods(
  candidates: FoodCandidate[],
  market: Map<number, MarketSnapshot>,
  options: RankOptions,
) {
  const scored = candidates
    .map((food) => ({
      food,
      hqScore: scoreFood(food.stats, options.weights, food.canBeHq ? "hq" : "nq").score,
    }))
    .filter((entry) => entry.hqScore > 0)
    .sort((a, b) => b.hqScore - a.hqScore || b.food.itemLevel - a.food.itemLevel);

  const top = scored.slice(0, options.topN);
  const bestScore = top[0]?.hqScore ?? 0;

  const rows = top.map(({ food }) => {
    const snapshot = market.get(food.itemId);
    const variants: Variant[] =
      options.variant === "best" ? (food.canBeHq ? ["hq", "nq"] : ["nq"]) : [options.variant];

    const evaluated = variants.map((variant) => {
      const { score, contributing } = scoreFood(food.stats, options.weights, variant);
      const listings = (snapshot?.listings ?? []).filter((l) => l.hq === (variant === "hq"));
      const fill = fillOrder(listings, options.quantity);
      const velocity = variant === "hq" ? snapshot?.hqSaleVelocity : snapshot?.nqSaleVelocity;
      return {
        variant,
        relevant_points: score,
        contributing_stats: contributing,
        pct_of_best_stats: bestScore > 0 ? Math.round((score / bestScore) * 1000) / 10 : null,
        avg_unit_price: fill?.avgUnitPrice ?? null,
        cheapest_unit_price: fill?.cheapestUnitPrice ?? null,
        cheapest_world: fill?.cheapestWorld ?? null,
        buy_from: fill?.worlds ?? [],
        units_available_for_order: fill?.unitsBought ?? 0,
        order_filled: fill?.filled ?? false,
        sales_per_day: velocity ?? null,
        gil_per_point:
          fill && score > 0 ? Math.round((fill.avgUnitPrice / score) * 100) / 100 : null,
      };
    });

    const priced = evaluated.filter((e) => e.gil_per_point != null);
    const best =
      priced.sort((a, b) => (a.gil_per_point as number) - (b.gil_per_point as number))[0] ??
      evaluated[0];

    const notes: string[] = [];
    if (best.avg_unit_price == null) notes.push("No listings in the searched scope.");
    else if (!best.order_filled)
      notes.push(`Only ${best.units_available_for_order} units listed; fewer than requested.`);
    if (
      options.minVelocity != null &&
      best.sales_per_day != null &&
      best.sales_per_day < options.minVelocity
    )
      notes.push(`Low sales velocity (${best.sales_per_day.toFixed(1)}/day); price may be stale.`);

    return {
      item_id: food.itemId,
      name: food.name,
      item_level: food.itemLevel,
      all_stats: food.stats,
      ...best,
      notes: notes.length ? notes : undefined,
    };
  });

  rows.sort(
    (a, b) =>
      (a.gil_per_point ?? Number.POSITIVE_INFINITY) - (b.gil_per_point ?? Number.POSITIVE_INFINITY),
  );
  return { rows, consideredCount: scored.length, bestScore };
}

/** Normalise a Universalis current-data response (single or multi item) into snapshots. */
export function parseUniversalisCurrent(
  payload: unknown,
  scope: string,
): Map<number, MarketSnapshot> {
  const out = new Map<number, MarketSnapshot>();
  if (!payload || typeof payload !== "object") return out;
  const p = payload as Record<string, unknown>;
  const items: unknown[] =
    p.items && typeof p.items === "object"
      ? Object.values(p.items as Record<string, unknown>)
      : [p];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (typeof it.itemID !== "number") continue;
    const listings = Array.isArray(it.listings) ? it.listings : [];
    out.set(it.itemID, {
      listings: listings
        .map((l) => l as Record<string, unknown>)
        .filter((l) => typeof l.pricePerUnit === "number" && typeof l.quantity === "number")
        .map((l) => ({
          pricePerUnit: l.pricePerUnit as number,
          quantity: l.quantity as number,
          hq: l.hq === true,
          worldName: typeof l.worldName === "string" ? l.worldName : scope,
          scope,
        })),
      hqSaleVelocity: typeof it.hqSaleVelocity === "number" ? it.hqSaleVelocity : 0,
      nqSaleVelocity: typeof it.nqSaleVelocity === "number" ? it.nqSaleVelocity : 0,
      lastUploadTime: typeof it.lastUploadTime === "number" ? it.lastUploadTime : null,
    });
  }
  return out;
}

/** Merge snapshots from several scopes (e.g. Chaos + Light). */
export function mergeSnapshots(maps: Map<number, MarketSnapshot>[]) {
  const out = new Map<number, MarketSnapshot>();
  for (const map of maps) {
    for (const [id, snap] of map) {
      const existing = out.get(id);
      if (!existing) {
        out.set(id, { ...snap, listings: [...snap.listings] });
        continue;
      }
      existing.listings.push(...snap.listings);
      existing.hqSaleVelocity += snap.hqSaleVelocity;
      existing.nqSaleVelocity += snap.nqSaleVelocity;
      existing.lastUploadTime =
        Math.max(existing.lastUploadTime ?? 0, snap.lastUploadTime ?? 0) || null;
    }
  }
  return out;
}
