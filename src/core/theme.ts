/**
 * The palette, in one place.
 *
 * CodeForge's interface uses layered graphite surfaces and a richer, clearly
 * differentiated accent palette. Monaco keeps its separate Tokyo Night syntax colors.
 * Keeping both here prevents chrome choices from washing out code highlighting.
 *
 * "Liquid" is a treatment, not a colour: translucent surfaces over a lit
 * background, a one-pixel top highlight, and long soft shadows. The tokens for
 * that live here too so a component never invents its own blur radius.
 */

/** Tokyo Night semantic syntax colors; Monaco token rules consume these values. */
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

/** Interface chrome colors, independent from Monaco syntax highlighting. */
export const INTERFACE = {
  bg: '#11141b',
  bgRaise: '#1a1e27',
  bgRaise2: '#252b37',
  bgSunken: '#0c0f15',
  border: '#354052',
  borderSoft: '#293241',
  text: '#e2e7f0',
  textDim: '#b2bdce',
  muted: '#8792a3',
  accent: '#78a9ff',
  accentSoft: '#3b5580',
  purple: '#c0a3ed',
  cyan: '#8dcdf5',
  teal: '#80cfb2',
  green: '#8fd2a0',
  yellow: '#e2b76f',
  red: '#e78d9b',
} as const;

/**
 * Project accents are stored by id, never by hex. Keep the historical ids so
 * existing projects load, with clear but softened shades that complement the graphite UI.
 */
export const ACCENTS = [
  { id: 'blue', label: 'Steel blue', hex: INTERFACE.accent },
  { id: 'purple', label: 'Lavender', hex: INTERFACE.purple },
  { id: 'teal', label: 'Teal', hex: INTERFACE.teal },
  { id: 'green', label: 'Sage', hex: INTERFACE.green },
  { id: 'orange', label: 'Amber', hex: INTERFACE.yellow },
  { id: 'red', label: 'Rose', hex: INTERFACE.red },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'];

export const DEFAULT_ACCENT: AccentId = 'blue';

/** The colour for an accent id, falling back rather than rendering `undefined`. */
export function accentHex(id: string | undefined): string {
  return ACCENTS.find((accent) => accent.id === id)?.hex ?? ACCENTS[0].hex;
}

/**
 * Editor themes.
 *
 * Two Tokyo Night surfaces for the editor. Syntax uses its own semantic color
 * palette; project accents are applied to the surrounding interface only.
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

/**
 * The interface values that `styles.css` mirrors as custom properties.
 * Keeping this list separate from Tokyo syntax colors prevents chrome styles
 * from accidentally recoloring code.
 */
/** `#7aa2f7` → `7aa2f7`, which is how Monaco wants token colours. */
function hex(value: string): string {
  return value.replace('#', '');
}

export const CSS_TOKENS: { name: string; value: string }[] = [
  { name: 'bg', value: INTERFACE.bg },
  { name: 'bg-raise', value: INTERFACE.bgRaise },
  { name: 'bg-raise-2', value: INTERFACE.bgRaise2 },
  { name: 'bg-sunken', value: INTERFACE.bgSunken },
  { name: 'border', value: INTERFACE.border },
  { name: 'border-soft', value: INTERFACE.borderSoft },
  { name: 'text', value: INTERFACE.text },
  { name: 'text-dim', value: INTERFACE.textDim },
  { name: 'muted', value: INTERFACE.muted },
  { name: 'accent', value: INTERFACE.accent },
  { name: 'accent-soft', value: INTERFACE.accentSoft },
  { name: 'purple', value: INTERFACE.purple },
  { name: 'cyan', value: INTERFACE.cyan },
  { name: 'teal', value: INTERFACE.teal },
  { name: 'ok', value: INTERFACE.green },
  { name: 'warn', value: INTERFACE.yellow },
  { name: 'error', value: INTERFACE.red },
];
