/**
 * FFXIV job lookup used to decide which food stats matter.
 *
 * Stat names match XIVAPI BaseParam names exactly. `stats` are the stats that
 * count towards a food's value for that job (weight 1 each by default).
 * Vitality is deliberately excluded: every combat meal has it and it doesn't
 * change which meal is better value.
 */

export type JobRole =
  | "tank"
  | "healer"
  | "melee"
  | "physical_ranged"
  | "caster"
  | "crafter"
  | "gatherer";

export interface JobInfo {
  abbr: string;
  name: string;
  /** Base class the job is unlocked from, if any. */
  baseClass?: { abbr: string; name: string };
  role: JobRole;
  stats: string[];
}

const COMBAT_DPS = ["Critical Hit", "Direct Hit Rate", "Determination"];
const TANK = ["Critical Hit", "Determination", "Direct Hit Rate", "Tenacity"];
const HEALER = ["Critical Hit", "Determination", "Direct Hit Rate"];
const CRAFTER = ["Craftsmanship", "Control", "CP"];
const GATHERER = ["Gathering", "Perception", "GP"];

export const JOBS: JobInfo[] = [
  // Tanks
  {
    abbr: "PLD",
    name: "Paladin",
    baseClass: { abbr: "GLA", name: "Gladiator" },
    role: "tank",
    stats: TANK,
  },
  {
    abbr: "WAR",
    name: "Warrior",
    baseClass: { abbr: "MRD", name: "Marauder" },
    role: "tank",
    stats: TANK,
  },
  { abbr: "DRK", name: "Dark Knight", role: "tank", stats: TANK },
  { abbr: "GNB", name: "Gunbreaker", role: "tank", stats: TANK },
  // Healers
  {
    abbr: "WHM",
    name: "White Mage",
    baseClass: { abbr: "CNJ", name: "Conjurer" },
    role: "healer",
    stats: HEALER,
  },
  { abbr: "SCH", name: "Scholar", role: "healer", stats: HEALER },
  { abbr: "AST", name: "Astrologian", role: "healer", stats: HEALER },
  { abbr: "SGE", name: "Sage", role: "healer", stats: HEALER },
  // Melee DPS
  {
    abbr: "MNK",
    name: "Monk",
    baseClass: { abbr: "PGL", name: "Pugilist" },
    role: "melee",
    stats: COMBAT_DPS,
  },
  {
    abbr: "DRG",
    name: "Dragoon",
    baseClass: { abbr: "LNC", name: "Lancer" },
    role: "melee",
    stats: COMBAT_DPS,
  },
  {
    abbr: "NIN",
    name: "Ninja",
    baseClass: { abbr: "ROG", name: "Rogue" },
    role: "melee",
    stats: COMBAT_DPS,
  },
  { abbr: "SAM", name: "Samurai", role: "melee", stats: COMBAT_DPS },
  { abbr: "RPR", name: "Reaper", role: "melee", stats: COMBAT_DPS },
  { abbr: "VPR", name: "Viper", role: "melee", stats: COMBAT_DPS },
  // Physical ranged DPS
  {
    abbr: "BRD",
    name: "Bard",
    baseClass: { abbr: "ARC", name: "Archer" },
    role: "physical_ranged",
    stats: COMBAT_DPS,
  },
  { abbr: "MCH", name: "Machinist", role: "physical_ranged", stats: COMBAT_DPS },
  { abbr: "DNC", name: "Dancer", role: "physical_ranged", stats: COMBAT_DPS },
  // Magical ranged DPS
  {
    abbr: "BLM",
    name: "Black Mage",
    baseClass: { abbr: "THM", name: "Thaumaturge" },
    role: "caster",
    stats: COMBAT_DPS,
  },
  {
    abbr: "SMN",
    name: "Summoner",
    baseClass: { abbr: "ACN", name: "Arcanist" },
    role: "caster",
    stats: COMBAT_DPS,
  },
  { abbr: "RDM", name: "Red Mage", role: "caster", stats: COMBAT_DPS },
  { abbr: "PCT", name: "Pictomancer", role: "caster", stats: COMBAT_DPS },
  // Disciples of the Hand
  { abbr: "CRP", name: "Carpenter", role: "crafter", stats: CRAFTER },
  { abbr: "BSM", name: "Blacksmith", role: "crafter", stats: CRAFTER },
  { abbr: "ARM", name: "Armorer", role: "crafter", stats: CRAFTER },
  { abbr: "GSM", name: "Goldsmith", role: "crafter", stats: CRAFTER },
  { abbr: "LTW", name: "Leatherworker", role: "crafter", stats: CRAFTER },
  { abbr: "WVR", name: "Weaver", role: "crafter", stats: CRAFTER },
  { abbr: "ALC", name: "Alchemist", role: "crafter", stats: CRAFTER },
  { abbr: "CUL", name: "Culinarian", role: "crafter", stats: CRAFTER },
  // Disciples of the Land
  { abbr: "MIN", name: "Miner", role: "gatherer", stats: GATHERER },
  { abbr: "BTN", name: "Botanist", role: "gatherer", stats: GATHERER },
  { abbr: "FSH", name: "Fisher", role: "gatherer", stats: GATHERER },
];

/** Food stat names, for validating user-supplied overrides. */
export const FOOD_STAT_NAMES = [
  "Critical Hit",
  "Direct Hit Rate",
  "Determination",
  "Skill Speed",
  "Spell Speed",
  "Tenacity",
  "Piety",
  "Vitality",
  "Craftsmanship",
  "Control",
  "CP",
  "Gathering",
  "Perception",
  "GP",
] as const;

const STAT_ALIASES: Record<string, string> = {
  crit: "Critical Hit",
  "critical hit": "Critical Hit",
  "critical hit rate": "Critical Hit",
  dh: "Direct Hit Rate",
  "direct hit": "Direct Hit Rate",
  "direct hit rate": "Direct Hit Rate",
  det: "Determination",
  determination: "Determination",
  sks: "Skill Speed",
  "skill speed": "Skill Speed",
  sps: "Spell Speed",
  "spell speed": "Spell Speed",
  ten: "Tenacity",
  tenacity: "Tenacity",
  pie: "Piety",
  piety: "Piety",
  vit: "Vitality",
  vitality: "Vitality",
  craftsmanship: "Craftsmanship",
  control: "Control",
  cp: "CP",
  gathering: "Gathering",
  perception: "Perception",
  gp: "GP",
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Resolve a job by abbreviation, job name, or base class (abbr or name). */
export function resolveJob(input: string): JobInfo | undefined {
  const key = normalize(input);
  return JOBS.find(
    (job) =>
      job.abbr.toLowerCase() === key ||
      job.name.toLowerCase() === key ||
      job.baseClass?.abbr.toLowerCase() === key ||
      job.baseClass?.name.toLowerCase() === key,
  );
}

/** Resolve a stat name or common shorthand (crit, dh, det, sks...) to its XIVAPI name. */
export function resolveStatName(input: string): string | undefined {
  return STAT_ALIASES[normalize(input)];
}
