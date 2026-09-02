/**
 * Kalm brand mark — an abstract four-petal bloom in the Soft Glass palette.
 * Uses semantic tokens only so it themes correctly in light and dark mode.
 */
export function KalmLogo({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-hidden focusable="false">
      <g opacity="0.9">
        <circle cx="16" cy="10" r="7" fill="currentColor" opacity="0.55" />
        <circle cx="22" cy="17" r="7" fill="currentColor" opacity="0.4" />
        <circle cx="16" cy="23" r="7" fill="currentColor" opacity="0.55" />
        <circle cx="10" cy="17" r="7" fill="currentColor" opacity="0.4" />
        <circle cx="16" cy="16.5" r="3.2" fill="currentColor" opacity="0.85" />
      </g>
    </svg>
  );
}
