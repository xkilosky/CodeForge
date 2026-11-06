/**
 * Release identity shown in the app. Every release tag is derived from the
 * shipped milestone list, keeping the UI, document title, and release notes in
 * step.
 */

interface MilestoneName {
  /** Internal milestone id used across the codebase and PLAN.md. */
  id: string;
  /** What the milestone is called, for the release note. */
  name: string;
  /** User-facing season and milestone tag, e.g. S2.1. */
  release: string;
}

/** Shipped milestones in chronological order. */
export const SHIPPED_MILESTONES: MilestoneName[] = [
  { id: 'M1', name: 'Web workspace', release: 'S1.1' },
  { id: 'M5', name: 'Visual game builder', release: 'S1.5' },
  { id: 'M6', name: 'Files, folders and a new interface', release: 'S1.6' },
  { id: 'M7', name: 'Development workflow evolution', release: 'S1.7' },
  { id: 'M8', name: 'Global project search', release: 'S1.8' },
  { id: 'M9', name: 'GitHub source control', release: 'S1.9' },
  { id: 'M12', name: 'Real-time error detection', release: 'S2.1' },
];

/** The next user-facing tag after the latest release. */
export function nextReleaseTag(): string {
  const latest = SHIPPED_MILESTONES[SHIPPED_MILESTONES.length - 1];
  const match = /^(S\d+)\.(\d+)$/.exec(latest?.release ?? 'S1.0');
  if (!match) return 'S1.1';
  return `${match[1]}.${Number(match[2]) + 1}`;
}

/** User-facing "not yet" line for an unshipped workspace. */
export function arrivesIn(): string {
  return `Arrives in Forge ${nextReleaseTag()}.`;
}

/** The same fact as a mid-sentence phrase: "arrives in Forge S2.2." */
export function arrivesInPhrase(): string {
  return `arrives in Forge ${nextReleaseTag()}.`;
}

export type ReleaseChannel = 'Platform Release' | 'Preview' | 'Maintenance';

export interface Release {
  /** e.g. `S2.1` */
  tag: string;
  /** e.g. `CodeForge - Forge S2.1` */
  title: string;
  channel: ReleaseChannel;
  /** What shipped, e.g. `M12 — Real-time error detection`. */
  milestone: string;
  summary: string;
}

/** The current release, derived from the last shipped milestone. */
export function currentRelease(): Release {
  const latest = SHIPPED_MILESTONES[SHIPPED_MILESTONES.length - 1];
  const tag = latest?.release ?? 'S1.0';
  return {
    tag,
    title: `CodeForge - Forge ${tag}`,
    channel: 'Platform Release',
    milestone: latest ? `${latest.id} — ${latest.name}` : 'M0 — Scaffold',
    summary: 'Catch code errors and type issues as you edit, with live editor diagnostics.',
  };
}
