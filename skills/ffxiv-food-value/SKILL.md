---
name: ffxiv-food-value
description: Finds the most cost-effective FFXIV food (meals) for a job by gil per relevant stat point on the market board, defaulting to the EU data centers Chaos and Light. Use when the user asks for the cheapest, best-value or most cost-effective food for a job such as BRD/Bard, SAM, RPR, or a crafter/gatherer, or asks whether last tier's food is a better deal than current best-in-slot.
---

# FFXIV best-value food

The current best-in-slot (BiS) meal usually sells at a premium, while last tier's equivalent often costs a fraction as much for nearly the same stats. Rank the top few meals by **gil per relevant stat point** so the user can see that trade-off at a glance.

## Steps

1. **Resolve the job.** Map whatever the user wrote (abbreviation, job name or base class) using `references/jobs.md`. Example: "Bard", "BRD" and "Archer" all mean BRD. The tool accepts any of these forms too, so pass the user's wording if it's unambiguous. If the user names several jobs, run the tool once per job; jobs that share a stat set (most DPS) will give the same result, so say that instead of repeating the table.

2. **Pick the scope.** Default to `["Chaos", "Light"]` (EU). Use a single DC, a world, or `"Europe"` if the user asks for one. Don't mix regions unless the user asks.

3. **Call `ffxiv_rank_food_value`** with:
   - `job`: the resolved job
   - `world_dc_region`: from step 2
   - `top_n`: 5 by default (the user's "top x options"); raise it to 8–10 when they want a wider net
   - `quantity`: what they plan to buy (default 10; a raid night is typically 5–10 meals; a full week of progression is closer to 20–30)
   - `variant`: `"best"` unless they insist on HQ
   - `min_velocity`: 1, to flag meals that barely sell
   - `stats` / `stat_weights`: only when the user wants something other than the job default (e.g. Skill/Spell Speed for a GCD tier). See the notes in `references/jobs.md`.

4. **Present a compact table**, sorted by gil per point (the tool already sorts):

   | Meal | HQ/NQ | iLvl | Relevant stats | % of top | Avg price | Gil/pt | Cheapest on |
   |---|---|---|---|---|---|---|---|

   - "Relevant stats" comes from `contributing_stats` (e.g. "Crit 151, Det 91").
   - Bold the best-value row. If it isn't the highest-stat meal, state the trade-off in one line, e.g. "Mate Cookie gives 94% of BiS stats for about a quarter of the price."
   - Name the cheapest world and point out when buying means a world visit, or a DC travel between Chaos and Light.

5. **Add caveats only when relevant:** rows with `notes` (no listings, thin supply, low sales velocity), `scope_errors` in the meta, and the fact that listing prices exclude the 5% market tax. Universalis data is crowd-sourced, so prices are only as fresh as the last player who viewed that item.

## Don't

- Don't count Vitality; the tool already ignores it for combat jobs.
- Don't recommend a meal that couldn't fill the requested quantity without saying so.
- Don't guess prices from memory. If the tool fails, report the failure.
