/**
 * The release name shown in the app.
 *
 * Every release is **Forge S<season>.<milestone>** with a channel beside it:
 *
 *     CodeForge - Forge S1.6
 *     Platform Release
 *
 * The number in front of the dot is the shipped milestone, so it is **derived
 * from the runtime registry** rather than typed twice. A hand-written "S1.5"
 * in a template string is a version number that goes stale on the next release
 * and nobody notices for a month — the list below already knows which
 * milestones are live, so it is the single source for this.
 *
 * Season is separate because it is a decision, not a count: S1 is the season
 * opened by the Web workspace. Adding a runtime to a later season is a one-line
 * change here plus the `season` on the milestone table below.
 */

/** One per shipped milestone, in the order they shipped. */
const SEASON = 1;

interface MilestoneName {
  /** The milestone id used across the codebase and PLAN.md. */
  id: string;
  /** What the milestone is called, for the release note. */
  name: string;
}

/**
 * Milestones that have shipped, oldest first. The list order is the version
 * order: the last entry is the current milestone.
 *
 * Declared here rather than inferred by counting `available` runtimes, because
 * a milestone can ship without adding a workspace — the projects home and the
 * mobile pass were both real releases with no new runtime.
 */
export const SHIPPED_MILESTONES: MilestoneName[] = [
  { id: 'M1', name: 'Web workspace' },
  { id: 'M5', name: 'Visual game builder' },
  { id: 'M6', name: 'Files, folders and a new interface' },
];

/**
 * When the next unshipped milestone lands, in user-facing words.
 *
 * "Arrives in M6" is a note to the team, not to the person looking at the
 * workspace tab — the milestone numbering is an internal build plan. This maps
 * it to the next release tag instead, so the UI can say "Forge S1.7".
 */
export function nextReleaseTag(): string {
  const latest = SHIPPED_MILESTONES[SHIPPED_MILESTONES.length - 1];
  const next = Number((latest?.id ?? 'M0').replace(/^M/, '')) + 1;
  return `S${SEASON}.${next}`;
}

/** User-facing "not yet" line for an unshipped workspace. */
export function arrivesIn(): string {
  return `Arrives in Forge ${nextReleaseTag()}.`;
}

/** The same fact as a mid-sentence phrase: "arrives in Forge S1.7." */
export function arrivesInPhrase(): string {
  return `arrives in Forge ${nextReleaseTag()}.`;
}

export type ReleaseChannel =
  | 'Platform Release'
  | 'Preview'
  | 'Maintenance';

export interface Release {
  /** e.g. `S1.6` */
  tag: string;
  /** e.g. `CodeForge - Forge S1.6` */
  title: string;
  /** e.g. `Platform Release` */
  channel: ReleaseChannel;
  /** What shipped, e.g. `M5 — Visual game builder`. */
  milestone: string;
  /** The short, human line under the version. */
  summary: string;
}

/**
 * The current release.
 *
 * The number is the highest shipped milestone, so it advances by editing
 * `SHIPPED_MILESTONES` when a milestone lands and by nothing else. There is no
 * second place to remember.
 */
export function currentRelease(): Release {
  const latest = SHIPPED_MILESTONES[SHIPPED_MILESTONES.length - 1];
  const tag = `S${SEASON}.${(latest?.id ?? 'M0').replace(/^M/, '')}`;
  return {
    tag,
    title: `CodeForge - Forge ${tag}`,
    channel: 'Platform Release',
    milestone: latest ? `${latest.id} — ${latest.name}` : 'M0 — Scaffold',
    summary:
      'A drawer for files and folders, a Tokyo Night interface, and projects you can export.',
  };
}
