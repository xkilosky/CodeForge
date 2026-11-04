/**
 * The CodeForge mark: an anvil clamped in a browser window, with `<>` cut into
 * its face and a blue squeegee across the horn.
 *
 * One component rather than an inline glyph in each place, because the top bar
 * and the projects home both show it and they used to carry their own copy of
 * the "⚒" character. The artwork is dark, so it sits on a light plate drawn in
 * CSS — on this app's dark chrome the anvil alone would be invisible, which is
 * the one thing a logo must never be.
 */
interface BrandMarkProps {
  /** Rendered size in CSS pixels. */
  size?: number;
  /** Decorative by default: both call sites already label themselves. */
  alt?: string;
}

export function BrandMark({ size = 22, alt = '' }: BrandMarkProps) {
  return (
    <img
      className="brand-mark"
      src="/brand/mark.png"
      width={size}
      height={size}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      // A mask would be tighter than the square, and the mark is wide; the
      // plate keeps it from being clipped into the anvil's silhouette.
      style={{ width: size, height: size }}
    />
  );
}
