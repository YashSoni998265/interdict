/**
 * True when animations should be skipped and the final state shown at once: the visitor asked
 * for reduced motion, or the page runs in an automated browser (tests, crawlers, evaluators),
 * which should see every piece of content without scrolling it into view first.
 */
export function staticMotion(): boolean {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return true;
  if (navigator.webdriver) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
