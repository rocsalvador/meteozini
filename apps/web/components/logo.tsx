export function Logo({ size = 28, withText = true, textSize = 20 }: { size?: number; withText?: boolean; textSize?: number }) {
  return (
    <span className="inline-flex items-center gap-2" style={{ color: "var(--foreground)" }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" fill="none">
        <circle cx="23.5" cy="8.5" r="3.2" stroke="var(--accent)" strokeWidth="1.7" />
        <path
          d="M7.8 23.5h12.7a4.4 4.4 0 0 0 .4-8.78A6.4 6.4 0 0 0 8.2 15.6a4.1 4.1 0 0 0-.4 7.9Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {withText && (
        <span className="font-mono font-bold leading-none" style={{ fontSize: textSize, letterSpacing: "-0.04em" }}>
          meteozini
        </span>
      )}
    </span>
  );
}
