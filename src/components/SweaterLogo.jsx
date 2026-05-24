/**
 * Sweater brand mark — a sweater silhouette with a triple-button placket
 * on the franchise's signature orange. Self-contained: the rounded orange
 * background is baked into the SVG so the calling site only needs to set
 * outer dimensions (and optional shadow / clip).
 *
 * Why inline SVG (not <img>): scales crisp at any DPR, ships zero extra
 * network requests, inherits dark-mode wrappers, and can be color-tuned
 * via CSS later without a new asset.
 */
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
      {/* Brand-orange rounded square — matches the existing rounded-xl
          radius (≈ 19% on a 64-unit viewBox). */}
      <rect width="64" height="64" rx="12" fill="#ea580c" />
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
