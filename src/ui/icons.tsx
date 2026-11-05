/**
 * Icons, as inline SVG.
 *
 * The app used to draw its chrome with emoji (🗀 ▶ ▤ ⧉ 🗑). Emoji are a font,
 * so their weight, colour and baseline belong to the OS: the same row of
 * controls looks different on macOS, Windows and Android, and none of them can
 * inherit the accent colour. These are 16px strokes on `currentColor`, so a
 * disabled control visibly dims and an active one takes the project accent.
 *
 * Every icon is decorative: the control that owns it carries the accessible
 * name, and a duplicate `aria-label` here would make a screen reader read the
 * button twice.
 */
interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className,
  };
}

export function ArrowLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

export function ChevronIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function FolderIcon({ size = 15, className, open = false }: IconProps & { open?: boolean }) {
  return (
    <svg {...svgProps(size, className)}>
      {open ? (
        <path d="M3 8.5V7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.5.7l.9 1.1H19a2 2 0 0 1 2 2v.7M3 8.5h16.2a1.6 1.6 0 0 1 1.6 1.9l-1.2 6.4a2 2 0 0 1-2 1.7H5.4a2 2 0 0 1-2-1.7L2.2 11a1.6 1.6 0 0 1 .8-2.5z" />
      ) : (
        <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.5.7l1.2 1.4H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      )}
    </svg>
  );
}

export function FileIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export function PlusIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function FolderPlusIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 7a2 2 0 0 1 2-2h3.5a2 2 0 0 1 1.5.7L11 7h6a2 2 0 0 1 2 2v3" />
      <path d="M3 9v8a2 2 0 0 0 2 2h6" />
      <path d="M17 15v6M14 18h6" />
    </svg>
  );
}

export function TrashIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function PencilIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" />
      <path d="M13.5 6.5L17.5 10.5" />
    </svg>
  );
}

export function CopyIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function SearchIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

export function SettingsIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function LayoutIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M3 9h18" />
    </svg>
  );
}

export function CloseIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function MenuIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function PlayIcon({ size = 13, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor" stroke="none">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

export function StopIcon({ size = 13, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function PaletteIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.9 2-2 0-.6-.2-1-.6-1.4-.4-.4-.6-.8-.6-1.3 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 0-10z" />
      <circle cx="8" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="13" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TerminalIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  );
}

export function CodeIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
    </svg>
  );
}

export function DownloadIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 4v10M8 11l4 4 4-4" />
      <path d="M5 18h14" />
    </svg>
  );
}

export function UploadIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 16V6M8 9l4-4 4 4" />
      <path d="M5 18h14" />
    </svg>
  );
}


/**
 * Icons by section id.
 *
 * One registry rather than an `icon:` on each row: the drawer and palette
 * share section ids, so a section cannot end up with two different glyphs.
 */
export const SECTION_ICONS = {
  files: FolderIcon,
  objects: LayoutIcon,
  code: CodeIcon,
  preview: PlayIcon,
  output: TerminalIcon,
  look: PaletteIcon,
  backup: DownloadIcon,
} as const;
