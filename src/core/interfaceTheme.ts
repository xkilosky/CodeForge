/**
 * Application-chrome themes, independent from each project's Monaco editor theme.
 * The preference belongs to the user and follows them across projects.
 */
export type InterfaceThemeId = 'vscode-dark' | 'cursor-midnight';

export const DEFAULT_INTERFACE_THEME: InterfaceThemeId = 'vscode-dark';

export const INTERFACE_THEMES: {
  id: InterfaceThemeId;
  label: string;
  note: string;
}[] = [
  { id: 'vscode-dark', label: 'VS Code Dark', note: 'Classic charcoal with vivid blue accents' },
  { id: 'cursor-midnight', label: 'Cursor Midnight', note: 'Cool slate surfaces with soft blue light' },
];

const STORAGE_KEY = 'codeforge:interface-theme';
type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): ThemeStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function resolveInterfaceTheme(value: unknown): InterfaceThemeId {
  return value === 'cursor-midnight' || value === 'vscode-dark'
    ? value
    : DEFAULT_INTERFACE_THEME;
}

/** Read the global chrome preference without failing in restricted storage modes. */
export function loadInterfaceTheme(storage = browserStorage()): InterfaceThemeId {
  try {
    return resolveInterfaceTheme(storage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_INTERFACE_THEME;
  }
}

/** Save a validated chrome preference; editor and project settings are untouched. */
export function saveInterfaceTheme(
  value: unknown,
  storage = browserStorage(),
): InterfaceThemeId {
  const theme = resolveInterfaceTheme(value);
  try {
    storage?.setItem(STORAGE_KEY, theme);
  } catch {
    // Keep the current session usable if browser storage is blocked.
  }
  return theme;
}
