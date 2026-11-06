import { useEffect } from 'react';

/**
 * Keep the compact workspace inside the visual viewport. Mobile browsers often
 * leave the layout viewport at full height when the software keyboard opens;
 * `visualViewport` reports the actually visible height and any browser pan.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const previousHeight = root.style.getPropertyValue('--visible-viewport-height');
    const previousTop = root.style.getPropertyValue('--visible-viewport-top');

    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      root.style.setProperty('--visible-viewport-height', `${height}px`);
      root.style.setProperty('--visible-viewport-top', `${top}px`);
    };

    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);

    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (previousHeight) root.style.setProperty('--visible-viewport-height', previousHeight);
      else root.style.removeProperty('--visible-viewport-height');
      if (previousTop) root.style.setProperty('--visible-viewport-top', previousTop);
      else root.style.removeProperty('--visible-viewport-top');
    };
  }, []);
}
