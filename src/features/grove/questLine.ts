/**
 * Keeper's Path — the progression spine of The Grove.
 *
 * Everything in this module is pure data + pure functions so the rules can be
 * unit tested without React, Three.js, or browser APIs. `GroveStore` owns the
 * mutable state and delegates every rule decision here.
 */

/** Lifetime counters the quest line and ranks are evaluated against. */
export interface GroveStats {
  sticksGathered: number;
  stonesGathered: number;
  floraGathered: number;
  toolsCrafted: number;
  torchesPlaced: number;
  treesFelled: number;
  hollowsFound: number;
  hollowsRestored: number;
  biomesDiscovered: number;
  nightsEndured: number;
  /** Times a rootling led the player to a Root Hollow. */
  creaturesGuided: number;
}

export type GroveStatKey = keyof GroveStats;

export const EMPTY_STATS: GroveStats = {
  sticksGathered: 0,
  stonesGathered: 0,
  floraGathered: 0,
  toolsCrafted: 0,
  torchesPlaced: 0,
  treesFelled: 0,
  hollowsFound: 0,
  hollowsRestored: 0,
  biomesDiscovered: 0,
  nightsEndured: 0,
  creaturesGuided: 0,
};

export interface QuestDef {
  id: string;
  title: string;
  /** Short flavour line shown under the title. */
  lore: string;
  /** Concrete, actionable instruction (mouse and keyboard). */
  hint: string;
  /** The same instruction for touch play, when it differs (button names instead of keys). */
  touchHint?: string;
  stat: GroveStatKey;
  /** Target value of `stat` measured from when the quest became active. */
  goal: number;
  /**
   * Measure `goal` against the stat's total instead of from activation.
   * For milestones the player may already have reached (a hollow found on
   * the way, biomes crossed early): a relative goal would never complete.
   */
  absolute?: boolean;
  essence: number;
}

/**
 * Ordered quest chain. Goals are relative to the stat value at the moment the
 * quest becomes active, so progress made earlier never silently completes a
 * later step (it still feels earned).
 */
export const QUEST_LINE: readonly QuestDef[] = [
  {
    id: 'awaken',
    title: 'Awaken',
    lore: 'The last grove flickers. Gather what the forest let fall.',
    hint: 'Look at fallen sticks and press Q to gather them.',
    touchHint: 'Look at fallen sticks and tap Gather.',
    stat: 'sticksGathered',
    goal: 3,
    essence: 10,
  },
  {
    id: 'stone-and-stick',
    title: 'Stone & Stick',
    lore: 'Every Keeper begins with bone-simple tools.',
    hint: 'Gather stones from the ground with Q.',
    touchHint: 'Gather stones from the ground with Gather.',
    stat: 'stonesGathered',
    goal: 2,
    essence: 10,
  },
  {
    id: 'first-tool',
    title: 'First Tool',
    lore: 'Bind stone to wood. Shape the world with intention.',
    hint: 'Select a stick and press C. Drag stones or shards onto its glowing points.',
    touchHint: 'Select a stick and tap Craft. Tap a stone or shard, then a glowing point.',
    stat: 'toolsCrafted',
    goal: 1,
    essence: 20,
  },
  {
    id: 'lumina-glow',
    title: 'Lumina Glow',
    lore: 'Cyan light still pulses in hidden places.',
    hint: 'Collect glowing Lumina flora with Q.',
    touchHint: 'Collect glowing Lumina flora with Gather.',
    stat: 'floraGathered',
    goal: 3,
    essence: 20,
  },
  {
    id: 'seek-the-hollow',
    title: 'Seek the Hollow',
    lore: 'An ancient stump dreams of what it was.',
    hint: 'Follow the Lumina Sense compass to a Root Hollow.',
    stat: 'hollowsFound',
    goal: 1,
    absolute: true,
    essence: 25,
  },
  {
    id: 'rekindle',
    title: 'Rekindle',
    lore: 'Give the light back to the roots.',
    hint: 'Select Lumina flora and place it beside the Root Hollow (right click).',
    touchHint: 'Select Lumina flora and place it beside the Root Hollow with Use.',
    stat: 'hollowsRestored',
    goal: 1,
    absolute: true,
    essence: 60,
  },
  {
    id: 'old-wood',
    title: 'The Old Wood',
    lore: 'Dead timber chokes the young. Clear it.',
    hint: 'Equip an axe (or a crafted tool) and fell 2 trees.',
    stat: 'treesFelled',
    goal: 2,
    essence: 25,
  },
  {
    id: 'light-the-dark',
    title: 'Light the Dark',
    lore: 'Caves remember the Lumina too.',
    hint: 'Place 3 torches (select torch, right click a surface).',
    touchHint: 'Place 3 torches (select a torch, face a surface, tap Use).',
    stat: 'torchesPlaced',
    goal: 3,
    essence: 30,
  },
  {
    id: 'wanderer',
    title: 'Wanderer',
    lore: 'The network once spanned every land.',
    hint: 'Discover 4 different biomes.',
    stat: 'biomesDiscovered',
    goal: 4,
    absolute: true,
    essence: 40,
  },
  {
    id: 'endure',
    title: 'Endure the Night',
    lore: 'Darkness is not the enemy. Forgetting is.',
    hint: 'Stay in the world until dawn breaks.',
    stat: 'nightsEndured',
    goal: 1,
    essence: 40,
  },
  {
    id: 'keeper',
    title: 'Keeper of the Grove',
    lore: 'Three hearts beating as one network.',
    hint: 'Restore 3 Root Hollows in total.',
    stat: 'hollowsRestored',
    goal: 3,
    absolute: true,
    essence: 150,
  },
];

/**
 * After the authored chain, the world keeps asking for more restoration.
 * Each endless tier asks for one more hollow than the last.
 */
export const endlessQuest = (tier: number): QuestDef => ({
  id: `renewal-${tier}`,
  title: `Renewal ${toRoman(tier)}`,
  lore: 'The network hungers. Every hollow reborn brightens the world.',
  hint: `Restore ${tier + 1} more Root Hollow${tier + 1 === 1 ? '' : 's'}.`,
  stat: 'hollowsRestored',
  goal: tier + 1,
  essence: 80 + tier * 40,
});

export const questAt = (index: number): QuestDef =>
  index < QUEST_LINE.length ? QUEST_LINE[index] : endlessQuest(index - QUEST_LINE.length + 1);

export interface Rank {
  title: string;
  minEssence: number;
}

export const RANKS: readonly Rank[] = [
  { title: 'Seedling', minEssence: 0 },
  { title: 'Sprout', minEssence: 40 },
  { title: 'Wanderer', minEssence: 120 },
  { title: 'Warden', minEssence: 250 },
  { title: 'Keeper', minEssence: 450 },
  { title: 'Elder Keeper', minEssence: 800 },
  { title: 'Heart of the Grove', minEssence: 1400 },
];

export const rankIndexFor = (essence: number): number => {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (essence >= RANKS[i].minEssence) idx = i;
  }
  return idx;
};

/**
 * Keeper's Stride: each rank quickens the Keeper on foot (+4% per rank), so
 * progression is felt in the hands, not just read in the HUD.
 */
export const STRIDE_PER_RANK = 0.04;
export const strideMultiplier = (essence: number): number => 1 + rankIndexFor(essence) * STRIDE_PER_RANK;

/** Essence granted directly for an action, independent of quests. */
export const ACTION_ESSENCE: Partial<Record<GroveStatKey, number>> = {
  floraGathered: 2,
  hollowsRestored: 40,
  biomesDiscovered: 15,
  treesFelled: 3,
  nightsEndured: 10,
  creaturesGuided: 12,
};

/**
 * World vitality (0..1) drives the colour grade: a fading, muted world blooms
 * into saturated warmth as the Keeper restores it. Restored hollows dominate;
 * exploration and night survival contribute a little.
 */
export const BASE_VITALITY = 0.3;
export const computeVitality = (stats: GroveStats): number => {
  const hollow = 1 - Math.pow(0.72, stats.hollowsRestored); // diminishing returns
  const explore = Math.min(1, stats.biomesDiscovered / 8) * 0.12;
  const endure = Math.min(1, stats.nightsEndured / 3) * 0.06;
  const v = BASE_VITALITY + (1 - BASE_VITALITY) * hollow * 0.82 + explore + endure;
  return Math.max(0, Math.min(1, v));
};

export type GroveNotice =
  | { kind: 'quest-complete'; title: string; essence: number }
  | { kind: 'quest-start'; title: string; hint: string; touchHint?: string }
  | { kind: 'rank-up'; title: string }
  | { kind: 'discovery'; title: string; detail: string };

export interface ProgressionState {
  stats: GroveStats;
  essence: number;
  questIndex: number;
  /** Stat value at the moment the current quest became active. */
  questBaseline: number;
}

export interface ProgressionResult {
  state: ProgressionState;
  notices: GroveNotice[];
}

export const questProgress = (state: ProgressionState): { value: number; goal: number } => {
  const quest = questAt(state.questIndex);
  const value = Math.max(0, state.stats[quest.stat] - (quest.absolute ? 0 : state.questBaseline));
  return { value: Math.min(value, quest.goal), goal: quest.goal };
};

/**
 * Apply a stat increment and resolve every consequence (action essence, quest
 * completions — possibly chained — and rank-ups). Pure: returns a new state.
 */
export const applyStat = (
  prev: ProgressionState,
  stat: GroveStatKey,
  amount = 1
): ProgressionResult => {
  if (amount <= 0) return { state: prev, notices: [] };

  const notices: GroveNotice[] = [];
  const stats: GroveStats = { ...prev.stats, [stat]: (prev.stats[stat] ?? 0) + amount };
  let essence = prev.essence + (ACTION_ESSENCE[stat] ?? 0) * amount;
  let questIndex = prev.questIndex;
  let questBaseline = prev.questBaseline;

  // Chain completions. A relative quest starts from a fresh baseline so it
  // never completes instantly; an absolute one already reached completes
  // straight away (e.g. the hollow was found before the quest asked for it).
  for (let guard = 0; guard < QUEST_LINE.length; guard++) {
    const quest = questAt(questIndex);
    const base = quest.absolute ? 0 : questBaseline;
    if (stats[quest.stat] - base < quest.goal) break;
    essence += quest.essence;
    notices.push({ kind: 'quest-complete', title: quest.title, essence: quest.essence });
    questIndex += 1;
    const next = questAt(questIndex);
    questBaseline = stats[next.stat];
    notices.push({ kind: 'quest-start', title: next.title, hint: next.hint, touchHint: next.touchHint });
  }

  const beforeRank = rankIndexFor(prev.essence);
  const afterRank = rankIndexFor(essence);
  if (afterRank > beforeRank) {
    notices.push({ kind: 'rank-up', title: RANKS[afterRank].title });
  }

  return { state: { stats, essence, questIndex, questBaseline }, notices };
};

export const initialProgression = (): ProgressionState => ({
  stats: { ...EMPTY_STATS },
  essence: 0,
  questIndex: 0,
  questBaseline: 0,
});

function toRoman(n: number): string {
  const table: Array<[number, string]> = [
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let rest = Math.max(1, Math.min(39, Math.floor(n)));
  for (const [v, s] of table) {
    while (rest >= v) { out += s; rest -= v; }
  }
  return out;
}
