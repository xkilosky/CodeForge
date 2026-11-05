/**
 * The palette, in one place.
 *
 * The app chrome and canvas use Tokyo Night tokens; the Monaco editor has its
 * own intentionally neutral Black and Graphite themes so syntax stays readable
 * without neon hues. This module is the single source for both palettes;
 * `styles.css` mirrors the chrome tokens and a test compares them so they
 * cannot drift silently.
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
 * Two neutral dark variants rather than a dark/light pair: pure near-black for
 * focused editing, and graphite for a softer VS Code-like surface. Syntax uses
 * grayscale contrast instead of bright semantic hues; the app's project accent
 * remains separate from editor token colors.
 */
export type EditorThemeId = 'tokyo-night' | 'tokyo-storm';

export const EDITOR_THEMES: { id: EditorThemeId; label: string; note: string }[] = [
  { id: 'tokyo-night', label: 'Black', note: 'Near-black with grayscale syntax' },
  { id: 'tokyo-storm', label: 'Graphite', note: 'Soft charcoal with grayscale syntax' },
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
        { token: '', foreground: 'e6e6e6' },
        { token: 'comment', foreground: '777777', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'f2f2f2', fontStyle: 'bold' },
        { token: 'keyword.control', foreground: 'f2f2f2', fontStyle: 'bold' },
        { token: 'storage', foreground: 'ededed' },
        { token: 'string', foreground: 'c9c9c9' },
        { token: 'string.escape', foreground: 'f0f0f0' },
        { token: 'number', foreground: 'bdbdbd' },
        { token: 'constant', foreground: 'bdbdbd' },
        { token: 'regexp', foreground: 'd8d8d8' },
        { token: 'type', foreground: 'ededed' },
        { token: 'type.identifier', foreground: 'ededed' },
        { token: 'entity.name.tag', foreground: 'f0f0f0' },
        { token: 'entity.other.attribute-name', foreground: 'c2c2c2' },
        { token: 'attribute.name', foreground: 'c2c2c2' },
        { token: 'tag', foreground: 'f0f0f0' },
        { token: 'metatag', foreground: 'd0d0d0' },
        { token: 'variable', foreground: 'e6e6e6' },
        { token: 'variable.predefined', foreground: 'd0d0d0' },
        { token: 'identifier', foreground: 'e6e6e6' },
        { token: 'function', foreground: 'ffffff' },
        { token: 'delimiter', foreground: 'a8a8a8' },
        { token: 'operator', foreground: 'b0b0b0' },
        { token: 'key', foreground: 'd0d0d0' },
      ],
      colors: {
        'editor.background': '#111111',
        'editor.foreground': '#e6e6e6',
        'editorLineNumber.foreground': '#555555',
        'editorLineNumber.activeForeground': '#b8b8b8',
        'editor.selectionBackground': '#45454588',
        'editor.inactiveSelectionBackground': '#38383855',
        'editor.lineHighlightBackground': '#1a1a1a',
        'editorCursor.foreground': '#f2f2f2',
        'editorIndentGuide.background1': '#292929',
        'editorIndentGuide.activeBackground1': '#505050',
        'editorWidget.background': '#1b1b1b',
        'editorWidget.border': '#343434',
        'editorSuggestWidget.background': '#1b1b1b',
        'editorSuggestWidget.selectedBackground': '#333333',
        'editorHoverWidget.background': '#1b1b1b',
        'editorBracketMatch.background': '#35353566',
        'editorBracketMatch.border': '#888888',
        'editorWhitespace.foreground': '#303030',
        'scrollbarSlider.background': '#50505055',
        'scrollbarSlider.hoverBackground': '#68686888',
        'scrollbarSlider.activeBackground': '#808080aa',
      },
    },
  },
  {
    id: 'tokyo-storm',
    data: {
      base: 'vs-dark',
      inherit: false,
      rules: [
        { token: '', foreground: 'e0e0e0' },
        { token: 'comment', foreground: '777777', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'f0f0f0', fontStyle: 'bold' },
        { token: 'storage', foreground: 'ededed' },
        { token: 'string', foreground: 'c9c9c9' },
        { token: 'number', foreground: 'bdbdbd' },
        { token: 'constant', foreground: 'bdbdbd' },
        { token: 'type', foreground: 'ededed' },
        { token: 'entity.name.tag', foreground: 'f0f0f0' },
        { token: 'attribute.name', foreground: 'c2c2c2' },
        { token: 'variable', foreground: 'e0e0e0' },
        { token: 'function', foreground: 'ffffff' },
        { token: 'delimiter', foreground: 'a8a8a8' },
        { token: 'operator', foreground: 'b0b0b0' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#e0e0e0',
        'editorLineNumber.foreground': '#666666',
        'editorLineNumber.activeForeground': '#c0c0c0',
        'editor.selectionBackground': '#4a4a4a88',
        'editor.inactiveSelectionBackground': '#38383855',
        'editor.lineHighlightBackground': '#252525',
        'editorCursor.foreground': '#f0f0f0',
        'editorIndentGuide.background1': '#333333',
        'editorIndentGuide.activeBackground1': '#5a5a5a',
        'editorWidget.background': '#252525',
        'editorWidget.border': '#414141',
        'editorSuggestWidget.background': '#252525',
        'editorSuggestWidget.selectedBackground': '#383838',
        'editorHoverWidget.background': '#252525',
        'editorBracketMatch.background': '#41414166',
        'editorBracketMatch.border': '#999999',
        'editorWhitespace.foreground': '#3a3a3a',
        'scrollbarSlider.background': '#55555555',
        'scrollbarSlider.hoverBackground': '#70707088',
        'scrollbarSlider.activeBackground': '#888888aa',
      },
    },
  },
];

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
