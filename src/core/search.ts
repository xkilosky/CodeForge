/**
 * Filtering for the quick-open palette, and for replace-in-project.
 *
 * A plain `includes` is the wrong answer for a file list: typing `mnjs` finds
 * `js/main.js` and typing `mn` finds `main.js`, and neither is a regex anyone
 * wants to debug. The scoring here is small on purpose — every rule below is
 * one a person can predict from the result order.
 */
import { nameOf } from './workspace';

export interface Scored<T> {
  item: T;
  score: number;
  /** Character indexes in the label that matched, for the highlight. */
  matches: number[];
}

/**
 * Subsequence match with a preference for contiguous runs, word starts and
 * shorter names.
 *
 * Returns null rather than 0 for "no match" so a caller cannot accidentally
 * treat a miss as the lowest-scoring hit and show it anyway.
 */
export function scoreMatch(label: string, query: string): { score: number; matches: number[] } | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return { score: 0, matches: [] };
  const haystack = label.toLowerCase();

  // A straight substring match is what the user actually meant; rank it above
  // any scattered subsequence and let the position decide the rest.
  const direct = haystack.indexOf(needle);
  if (direct !== -1) {
    const matches = Array.from({ length: needle.length }, (_, i) => direct + i);
    // Earlier and shorter is better, and a hit in the filename beats one in a
    // folder name.
    const tail = haystack.length - (direct + needle.length);
    const boundary = direct === 0 || /[/\-_. ]/.test(haystack[direct - 1]) ? 60 : 0;
    return { score: 1000 - direct * 2 - tail + boundary, matches };
  }

  // Subsequence, preferring runs that start a word.
  const matches: number[] = [];
  let cursor = 0;
  let score = 0;
  let previous = -2;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;
    matches.push(found);
    score += found === previous + 1 ? 18 : 4;
    if (found === 0 || /[/\-_. ]/.test(haystack[found - 1])) score += 12;
    previous = found;
    cursor = found + 1;
  }
  return { score: score - haystack.length, matches };
}

export interface FileChoice {
  path: string;
  name: string;
}

/** Ranked file paths for the palette. An empty query lists everything. */
export function rankFiles(paths: string[], query: string, limit = 40): Scored<FileChoice>[] {
  const out: Scored<FileChoice>[] = [];
  for (const path of paths) {
    const name = nameOf(path);
    // Match against the name first: `main` should reach `src/js/main.js`
    // without the user typing the folders.
    const byName = scoreMatch(name, query);
    const byPath = byName ?? scoreMatch(path, query);
    if (!byPath) continue;
    out.push({
      item: { path, name },
      // A name match is what the eye is doing; a path-only match is a fallback.
      score: byPath.score + (byName ? 120 : 0),
      matches: byName ? byPath.matches : [],
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Splits a label into runs, for rendering the matched characters. */
export function highlight(name: string, matches: number[]): { text: string; hit: boolean }[] {
  const set = new Set(matches);
  const runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < name.length; i += 1) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += name[i];
    else runs.push({ text: name[i], hit });
  }
  return runs;
}
