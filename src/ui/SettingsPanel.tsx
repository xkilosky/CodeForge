/**
 * The "Look" section: accent and editor theme.
 *
 * Two settings, both project-scoped, both applied instantly. They are here
 * rather than in a modal because the whole point is to see the change while
 * choosing it, and a modal covers the thing being restyled.
 */
import type { Project } from '../core/types';
import { ACCENTS, EDITOR_THEMES, resolveEditorTheme, type AccentId, type EditorThemeId } from '../core/theme';
import { PaletteIcon } from './icons';

interface SettingsPanelProps {
  project: Project;
  onAccent: (accent: AccentId) => void;
  onTheme: (theme: EditorThemeId) => void;
}

export function SettingsPanel({ project, onAccent, onTheme }: SettingsPanelProps) {
  const theme = resolveEditorTheme(project.settings.theme);

  return (
    <section className="settings" id="pane-look" aria-labelledby="settings-heading">
      <h2 id="settings-heading" className="settings-heading">
        <PaletteIcon size={15} /> Look
      </h2>

      <div className="settings-group">
        <div className="settings-label">Accent</div>
        <p className="muted settings-note">
          Colours the active tab, the run button and this project's chip.
        </p>
        <div className="swatches" role="radiogroup" aria-label="Accent">
          {ACCENTS.map((accent) => {
            const active = (project.accent ?? 'blue') === accent.id;
            return (
              <button
                key={accent.id}
                role="radio"
                aria-checked={active}
                aria-label={accent.label}
                title={accent.label}
                className={`swatch${active ? ' active' : ''}`}
                style={{ background: accent.hex }}
                onClick={() => onAccent(accent.id)}
              />
            );
          })}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">Editor theme</div>
        <div className="theme-options" role="radiogroup" aria-label="Editor theme">
          {EDITOR_THEMES.map((option) => {
            const active = theme === option.id;
            return (
              <button
                key={option.id}
                role="radio"
                aria-checked={active}
                className={`theme-option${active ? ' active' : ''}`}
                onClick={() => onTheme(option.id)}
              >
                <span className={`theme-swatch ${option.id}`} aria-hidden="true" />
                <span className="theme-text">
                  <span className="theme-name">{option.label}</span>
                  <span className="theme-note">{option.note}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

    </section>
  );
}
