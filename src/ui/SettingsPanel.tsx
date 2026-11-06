/**
 * The "Look" section: global interface theme, project accent, and editor theme.
 *
 * Chrome theme follows the user between projects; accent and Monaco theme stay
 * project-scoped. All three apply instantly so the user can see the result.
 */
import type { Project } from '../core/types';
import { ACCENTS, EDITOR_THEMES, resolveEditorTheme, type AccentId, type EditorThemeId } from '../core/theme';
import { INTERFACE_THEMES, type InterfaceThemeId } from '../core/interfaceTheme';
import { PaletteIcon } from './icons';

interface SettingsPanelProps {
  project: Project;
  interfaceTheme: InterfaceThemeId;
  onAccent: (accent: AccentId) => void;
  onTheme: (theme: EditorThemeId) => void;
  onInterfaceTheme: (theme: InterfaceThemeId) => void;
}

export function SettingsPanel({
  project,
  interfaceTheme,
  onAccent,
  onTheme,
  onInterfaceTheme,
}: SettingsPanelProps) {
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
        <div className="settings-label">Interface theme</div>
        <p className="muted settings-note">
          Changes app surfaces and controls only. Editor colors stay independent.
        </p>
        <div className="theme-options" role="radiogroup" aria-label="Interface theme">
          {INTERFACE_THEMES.map((option) => {
            const active = interfaceTheme === option.id;
            return (
              <button
                key={option.id}
                role="radio"
                aria-checked={active}
                className={`theme-option interface-theme-option${active ? ' active' : ''}`}
                onClick={() => onInterfaceTheme(option.id)}
              >
                <span className={`interface-theme-preview ${option.id}`} aria-hidden="true" />
                <span className="theme-text">
                  <span className="theme-name">{option.label}</span>
                  <span className="theme-note">{option.note}</span>
                </span>
              </button>
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
