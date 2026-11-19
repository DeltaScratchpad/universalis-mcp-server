# Job lookup

The `ffxiv_rank_food_value` tool accepts any of these forms (case-insensitive) and uses the same table internally (`src/data/jobs.ts`). Keep the two in sync if you edit either.

| Abbr | Job | Base class | Role | Food stats counted |
|---|---|---|---|---|
| PLD | Paladin | GLA Gladiator | Tank | Crit, Det, DH, Tenacity |
| WAR | Warrior | MRD Marauder | Tank | Crit, Det, DH, Tenacity |
| DRK | Dark Knight | – | Tank | Crit, Det, DH, Tenacity |
| GNB | Gunbreaker | – | Tank | Crit, Det, DH, Tenacity |
| WHM | White Mage | CNJ Conjurer | Healer | Crit, Det, DH |
| SCH | Scholar | – | Healer | Crit, Det, DH |
| AST | Astrologian | – | Healer | Crit, Det, DH |
| SGE | Sage | – | Healer | Crit, Det, DH |
| MNK | Monk | PGL Pugilist | Melee | Crit, DH, Det |
| DRG | Dragoon | LNC Lancer | Melee | Crit, DH, Det |
| NIN | Ninja | ROG Rogue | Melee | Crit, DH, Det |
| SAM | Samurai | – | Melee | Crit, DH, Det |
| RPR | Reaper | – | Melee | Crit, DH, Det |
| VPR | Viper | – | Melee | Crit, DH, Det |
| BRD | Bard | ARC Archer | Physical ranged | Crit, DH, Det |
| MCH | Machinist | – | Physical ranged | Crit, DH, Det |
| DNC | Dancer | – | Physical ranged | Crit, DH, Det |
| BLM | Black Mage | THM Thaumaturge | Caster | Crit, DH, Det |
| SMN | Summoner | ACN Arcanist | Caster | Crit, DH, Det |
| RDM | Red Mage | – | Caster | Crit, DH, Det |
| PCT | Pictomancer | – | Caster | Crit, DH, Det |
| CRP BSM ARM GSM LTW WVR ALC CUL | Crafters | – | Crafter | Craftsmanship, Control, CP |
| MIN BTN FSH | Gatherers | – | Gatherer | Gathering, Perception, GP |

ACN (Arcanist) maps to SMN; pass `"SCH"` explicitly for Scholar.

## Stat shorthand accepted in `stats` and `stat_weights`

crit, dh, det, sks (Skill Speed), sps (Spell Speed), ten (Tenacity), pie (Piety), vit, craftsmanship, control, cp, gathering, perception, gp.

## When to override the defaults

- **Speed food for a GCD tier:** if the user says their set needs Skill Speed (physical jobs) or Spell Speed (casters/healers) from food, pass e.g. `stats: ["crit", "dh", "det", "sks"]`, or weight speed up.
- **Tanks:** Tenacity is counted at weight 1 like the others. If the user doesn't value it, pass `stat_weights: {"ten": 0}`.
- **Healers who want Piety food:** add `"pie"` to `stats`.
- **Crit-weighted value:** for DPS, Crit is often worth slightly more per point than DH or Det. If the user wants that nuance, try `stat_weights: {"crit": 1.1}`; the defaults treat all relevant stats equally.
