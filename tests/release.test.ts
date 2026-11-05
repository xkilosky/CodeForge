/**
 * The release identity.
 *
 * The rule is that every update is named **Forge S<season>.<milestone>**, so
 * the tag is derived from the shipped-milestone list rather than typed into a
 * template. These tests exist because a hand-written version string goes stale
 * silently: it is the one piece of UI that is wrong for a whole release and
 * still compiles, renders, and passes every other test.
 */
import { describe, expect, it } from 'vitest';
import {
  SHIPPED_MILESTONES,
  arrivesIn,
  arrivesInPhrase,
  currentRelease,
  nextReleaseTag,
} from '../src/core/release';
import { RUNTIMES } from '../src/runtimes/registry';
import { TEMPLATES } from '../src/core/templates';
import { readFileSync } from 'node:fs';

describe('release identity', () => {
  it('names the current release Forge S1.9', () => {
    const release = currentRelease();
    expect(release.tag).toBe('S1.9');
    expect(release.title).toBe('CodeForge - Forge S1.9');
    expect(release.channel).toBe('Platform Release');
    expect(release.milestone).toBe('M9 — GitHub source control');
  });

  it('derives the number from the last shipped milestone', () => {
    const latest = SHIPPED_MILESTONES[SHIPPED_MILESTONES.length - 1];
    expect(currentRelease().tag).toBe(`S1.${latest.id.replace(/^M/, '')}`);
  });

  it('points at the next milestone for work that has not shipped', () => {
    expect(nextReleaseTag()).toBe('S1.10');
    expect(arrivesIn()).toBe('Arrives in Forge S1.10.');
    expect(arrivesInPhrase()).toBe('arrives in Forge S1.10.');
  });

  it('lists only milestones whose runtime exists', () => {
    // M5 is listed as shipped, so the game runtime must actually be available.
    // A version claiming a milestone that is not in the build is the same lie
    // as a stale string, just harder to spot.
    for (const milestone of SHIPPED_MILESTONES) {
      if (milestone.id === 'M5') {
        expect(RUNTIMES.find((r) => r.id === 'game')?.available).toBe(true);
      }
    }
  });

  it('keeps internal milestone codes out of user-facing copy', () => {
    // The tab said "Arrives in M6" — a note to the team, rendered to a user who
    // has no idea what M6 is.
    for (const runtime of RUNTIMES.filter((r) => !r.available)) {
      expect(runtime.unavailableReason).toMatch(/^Arrives in Forge S\d+\.\d+\.$/);
      expect(runtime.unavailableReason).not.toMatch(/\bM\d\b/);
    }
    for (const template of TEMPLATES) {
      expect(template.description).not.toMatch(/\bM\d\b/);
    }
  });

  it('does not hard-code the version in a component', () => {
    // The tag must come from currentRelease(), or the next release edits one
    // file and forgets the other.
    for (const file of ['src/ui/TopBar.tsx', 'src/ui/ProjectsHome.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).toContain('currentRelease');
      expect(source, file).not.toMatch(/S1\.\d/);
    }
  });

  it('puts the release on both the home screen and the app bar', () => {
    const bar = readFileSync('src/ui/TopBar.tsx', 'utf8');
    const home = readFileSync('src/ui/ProjectsHome.tsx', 'utf8');
    expect(bar).toContain('brand-version');
    expect(bar).toContain('release.title');
    expect(home).toContain('release.title');
    expect(home).toContain('release.channel');
  });

  it('keeps the static fallback title in step with the derived one', () => {
    // index.html is what a crawler sees before React boots. If it is not the
    // same string, the tab in a search result is a release behind.
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(`<title>${currentRelease().title}</title>`);
  });

  it('keeps the drawer and the home screen on the same release', () => {
    // Two places show the tag. One of them silently lagging is the exact
    // failure the derived value exists to prevent.
    const drawer = readFileSync('src/ui/Drawer.tsx', 'utf8');
    expect(drawer).toContain('release.tag');
    expect(drawer).not.toMatch(/S1\.\d/);
  });
});
