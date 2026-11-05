/**
 * The palette, in one place.
 *
 * Tokyo Night is a set of hex values, not a mood: the app chrome, the Monaco
 * editor and the canvas all have to agree on what `#7aa2f7` means, or the editor
 * ends up looking pasted into the app. This module is the single source for
 * those values; `styles.css` mirrors them as custom properties and a test
 * compares the two so they cannot drift silently.
 *
 * "Liquid" is a treatment, not a colour: translucent surfaces over a lit
 * background, a one-pixel top highlight, and long soft shadows. The tokens for
 * that live here too so a component never invents its own blur radius.
 */

/** Core hex values. Keys are camelCase; styles.css declares them kebab-case. */
export const TOKYO = {
  bg: '#16161e',
  bgRaise: '#1a1b26',
  bgRaise2: '#202334',
  bgSunken: '#13131a',
  border: '#2a2e42',
  borderSoft: '#222536',
  text: '#c0caf5',
  textDim: '#a9b1d6',
  muted: '#7f87a8',
  accent: '#7aa2f7',
  accentSoft: '#3d59a1',
  purple: '#bb9af7',
  cyan: '#7dcfff',
  teal: '#73daca',
  green: '#9ece6a',
  yellow: '#e0af68',
  orange: '#ff9e64',
  red: '#f7768e',
  /** Editor gutter numbers: dim, but not invisible. */
  gutter: '#3b4261',
} as const;

export type TokyoToken = keyof typeof TOKYO;

/**
 * Project accents.
 *
 * Stored on the project as an **id**, not a hex string: a saved hex would keep
 * pointing at a colour after the palette is retuned, which is exactly the kind
 * of stale value this codebase keeps having to remove.
 */
export const ACCENTS = [
  { id: 'blue', label: 'Blue', hex: TOKYO.accent },
  { id: 'purple', label: 'Purple', hex: TOKYO.purple },
  { id: 'teal', label: 'Teal', hex: TOKYO.teal },
  { id: 'green', label: 'Green', hex: TOKYO.green },
  { id: 'orange', label: 'Orange', hex: TOKYO.orange },
  { id: 'red', label: 'Red', hex: TOKYO.red },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'];

export const DEFAULT_ACCENT: AccentId = 'blue';

/** The colour for an accent id, falling back rather than rendering `undefined`. */
export function accentHex(id: string | undefined): string {
  return ACCENTS.find((accent) => accent.id === id)?.hex ?? TOKYO.accent;
}

/**
 * Editor themes.
 *
 * Two variants of the same scheme rather than a dark/light pair: the chrome is
 * dark by design, and a light editor inside dark chrome reads as a bug. `night`
 * is the true `#1a1b26`; `storm` lifts the editor to `#24283b` so it separates
 * from the app background when the drawer is open.
 */
export type EditorThemeId = 'tokyo-night' | 'tokyo-storm';

export const EDITOR_THEMES: { id: EditorThemeId; label: string; note: string }[] = [
  { id: 'tokyo-night', label: 'Night', note: 'Deep #1a1b26 editor' },
  { id: 'tokyo-storm', label: 'Storm', note: 'Lifted #24283b editor' },
];

/**
 * Maps anything a saved project might hold onto a theme this build has.
 *
 * Projects written before S1.6 stored Monaco's stock ids (`vs-dark`, `vs`).
 * Reading those through this function means an old project opens in the new
 * scheme instead of needing a migration pass over IndexedDB.
 */
export function resolveEditorTheme(id: string | undefined): EditorThemeId {
  if (id === 'tokyo-night' || id === 'tokyo-storm') return id;
  if (id === 'vs' || id === 'tokyo-day') return 'tokyo-storm';
  return 'tokyo-night';
}

/** Shape of a Monaco theme, declared here so `core` stays free of Monaco. */
export interface MonacoThemeData {
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: { token: string; foreground?: string; background?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

export const MONACO_THEMES: { id: EditorThemeId; data: MonacoThemeData }[] = [
  {
    id: 'tokyo-night',
    data: {
      base: 'vs-dark',
      inherit: false,
      rules: [
        { token: '', foreground: hex(TOKYO.text) },
        { token: 'comment', foreground: hex('#565f89'), fontStyle: 'italic' },
        { token: 'keyword', foreground: hex(TOKYO.purple) },
        { token: 'keyword.control', foreground: hex(TOKYO.purple) },
        { token: 'storage', foreground: hex(TOKYO.purple) },
        { token: 'string', foreground: hex(TOKYO.green) },
        { token: 'string.escape', foreground: hex(TOKYO.cyan) },
        { token: 'number', foreground: hex(TOKYO.orange) },
        { token: 'constant', foreground: hex(TOKYO.orange) },
        { token: 'regexp', foreground: hex('#b4f9f8') },
        { token: 'type', foreground: hex('#2ac3de') },
        { token: 'type.identifier', foreground: hex('#2ac3de') },
        { token: 'entity.name.tag', foreground: hex(TOKYO.red) },
        { token: 'entity.other.attribute-name', foreground: hex(TOKYO.yellow) },
        { token: 'attribute.name', foreground: hex(TOKYO.yellow) },
        { token: 'tag', foreground: hex(TOKYO.red) },
        { token: 'metatag', foreground: hex(TOKYO.purple) },
        { token: 'variable', foreground: hex(TOKYO.text) },
        { token: 'variable.predefined', foreground: hex(TOKYO.cyan) },
        { token: 'identifier', foreground: hex(TOKYO.text) },
        { token: 'function', foreground: hex(TOKYO.accent) },
        { token: 'delimiter', foreground: hex('#89ddff') },
        { token: 'operator', foreground: hex('#89ddff') },
        { token: 'key', foreground: hex(TOKYO.cyan) },
      ],
      colors: {
        'editor.background': TOKYO.bgRaise,
        'editor.foreground': TOKYO.text,
        'editorLineNumber.foreground': TOKYO.gutter,
        'editorLineNumber.activeForeground': TOKYO.muted,
        'editor.selectionBackground': '#3d59a166',
        'editor.inactiveSelectionBackground': '#3d59a133',
        'editor.lineHighlightBackground': '#1e2030',
        'editorCursor.foreground': TOKYO.accent,
        'editorIndentGuide.background1': '#2a2e42',
        'editorIndentGuide.activeBackground1': '#3b4261',
        'editorWidget.background': TOKYO.bgRaise2,
        'editorWidget.border': TOKYO.border,
        'editorSuggestWidget.background': TOKYO.bgRaise2,
        'editorSuggestWidget.selectedBackground': '#2e3550',
        'editorHoverWidget.background': TOKYO.bgRaise2,
        'editorBracketMatch.background': '#3d59a144',
        'editorBracketMatch.border': TOKYO.accent,
        'editorWhitespace.foreground': '#2a2e42',
        'scrollbarSlider.background': '#3b426166',
        'scrollbarSlider.hoverBackground': '#3b4261aa',
        'scrollbarSlider.activeBackground': '#3b4261dd',
      },
    },
  },
  {
    id: 'tokyo-storm',
    data: {
      base: 'vs-dark',
      inherit: false,
      rules: [
        { token: '', foreground: hex(TOKYO.text) },
        { token: 'comment', foreground: hex('#565f89'), fontStyle: 'italic' },
        { token: 'keyword', foreground: hex(TOKYO.purple) },
        { token: 'storage', foreground: hex(TOKYO.purple) },
        { token: 'string', foreground: hex(TOKYO.green) },
        { token: 'number', foreground: hex(TOKYO.orange) },
        { token: 'constant', foreground: hex(TOKYO.orange) },
        { token: 'type', foreground: hex('#2ac3de') },
        { token: 'entity.name.tag', foreground: hex(TOKYO.red) },
        { token: 'attribute.name', foreground: hex(TOKYO.yellow) },
        { token: 'variable', foreground: hex(TOKYO.text) },
        { token: 'function', foreground: hex(TOKYO.accent) },
        { token: 'delimiter', foreground: hex('#89ddff') },
        { token: 'operator', foreground: hex('#89ddff') },
      ],
      colors: {
        'editor.background': '#24283b',
        'editor.foreground': TOKYO.text,
        'editorLineNumber.foreground': '#414868',
        'editorLineNumber.activeForeground': TOKYO.textDim,
        'editor.selectionBackground': '#3d59a166',
        'editor.lineHighlightBackground': '#292e42',
        'editorCursor.foreground': TOKYO.accent,
        'editorIndentGuide.background1': '#3b4261',
        'editorWidget.background': '#1f2335',
        'editorWidget.border': '#3b4261',
        'editorSuggestWidget.background': '#1f2335',
        'editorHoverWidget.background': '#1f2335',
        'editorWhitespace.foreground': '#3b4261',
        'scrollbarSlider.background': '#3b426166',
      },
    },
  },
];

/** `#7aa2f7` → `7aa2f7`, which is how Monaco wants token colours. */
function hex(value: string): string {
  return value.replace('#', '');
}

/**
 * The subset of the palette that `styles.css` must declare verbatim.
 *
 * Everything else is a treatment value (blur radius, gradient stop) and has no
 * business being asserted against a stylesheet.
 */
export const CSS_TOKENS: { name: string; value: string }[] = [
  { name: 'bg', value: TOKYO.bg },
  { name: 'bg-raise', value: TOKYO.bgRaise },
  { name: 'bg-raise-2', value: TOKYO.bgRaise2 },
  { name: 'bg-sunken', value: TOKYO.bgSunken },
  { name: 'border', value: TOKYO.border },
  { name: 'border-soft', value: TOKYO.borderSoft },
  { name: 'text', value: TOKYO.text },
  { name: 'muted', value: TOKYO.muted },
  { name: 'accent', value: TOKYO.accent },
  { name: 'accent-soft', value: TOKYO.accentSoft },
  { name: 'purple', value: TOKYO.purple },
  { name: 'cyan', value: TOKYO.cyan },
  { name: 'teal', value: TOKYO.teal },
  { name: 'ok', value: TOKYO.green },
  { name: 'warn', value: TOKYO.yellow },
  { name: 'error', value: TOKYO.red },
];
