// Inline Arkiv `[ A ]` mark. Lives in JSX (not <img src=...>) so the path
// fill picks up the current text color, letting us recolor the logo via
// CSS — useful for matching whatever theme we're on.

export function ArkivMark({
  className = "h-7 w-auto text-foreground",
}: { className?: string }) {
  return (
    <svg
      role="img"
      aria-label="Arkiv"
      viewBox="0 0 54 31"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M47.1367 0H53.9847V30.24H47.1367V25.664H49.4407V4.576H47.1367V0Z"
        fill="currentColor"
      />
      <path
        d="M37.1357 25.1202H31.9837L30.4157 20.2882H23.3117L21.7117 25.1202H16.8477V23.3282L24.2717 2.72021H29.6797L37.1357 23.3282V25.1202ZM28.8797 15.6802L26.8957 9.56822L24.8477 15.6802H28.8797Z"
        fill="currentColor"
      />
      <path
        d="M6.848 30.24H0V0H6.848V4.576H4.544V25.664H6.848V30.24Z"
        fill="currentColor"
      />
    </svg>
  );
}
