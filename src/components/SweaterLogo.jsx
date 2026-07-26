/**
 * Sweater brand marks.
 *
 * `SweaterWordmark` renders the OFFICIAL lockup from sweater.sa — the
 * "SWEATER / سويتر" wordmark beside the garment icon — bundled locally at
 * /brand/sweater-logo.png so it also resolves inside the offline Android
 * build, where a remote asset would silently fail to load.
 *
 * `SweaterLogo` (default) stays an inline SVG of the icon alone: square
 * slots (sidebar chip, small badges) need a mark that holds its shape at
 * 32–56px, where the wide lockup would be illegible. It also ships zero
 * requests and stays crisp at any DPR.
 */

/** Official horizontal lockup — wordmark + icon. Use where width allows. */
export function SweaterWordmark({ className = '', title = 'سويتر | Sweater' }) {
  return (
    <img
      src="/brand/sweater-logo.png"
      alt={title}
      className={className}
      width="524"
      height="216"
      decoding="async"
    />
  );
}

/** Icon-only mark on the brand orange — for square slots. */
export default function SweaterLogo({ className = '', title = 'سويتر' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      {/* Brand-orange rounded square — --sw-brand-500 from the token layer. */}
      <rect width="64" height="64" rx="14" fill="#ef5b0c" />
      {/* Sweater silhouette: two shoulder peaks → small neckline V →
          straight body → side-split hem with a central notch. */}
      <path
        d="M 8 22 L 22 8 L 28 22 L 32 18 L 36 22 L 42 8 L 56 22 L 46 30 L 46 48 L 52 56 L 32 50 L 12 56 L 18 48 L 18 30 Z"
        fill="none"
        stroke="white"
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Triple-button placket. */}
      <circle cx="32" cy="30" r="1.8" fill="white" />
      <circle cx="32" cy="36" r="1.8" fill="white" />
      <circle cx="32" cy="42" r="1.8" fill="white" />
    </svg>
  );
}
