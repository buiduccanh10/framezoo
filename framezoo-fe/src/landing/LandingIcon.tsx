interface LandingIconProps {
  className?: string;
}

export function ArrowUpRightIcon({ className }: LandingIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
    >
      <path
        d="M5 15 15 5M6 5h9v9"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DownloadIcon({ className }: LandingIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
    >
      <path
        d="M10 3.5v8m0 0 3-3m-3 3-3-3M4.5 13v3h11v-3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowUpIcon({ className }: LandingIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
    >
      <path
        d="M10 15V5m0 0L6.5 8.5M10 5l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MessageSquareIcon({ className }: LandingIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
