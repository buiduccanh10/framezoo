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

export function HeartIcon({ className }: LandingIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
    >
      <path d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6.02 6.02 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z" />
    </svg>
  );
}

function BrandSocialIcon({
  className,
  path,
}: LandingIconProps & { path: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 448 512"
      width="18"
      height="18"
      fill="currentColor"
    >
      <path d={path} />
    </svg>
  );
}

export function TikTokIcon({ className }: LandingIconProps) {
  return (
    <BrandSocialIcon
      className={className}
      path="M448.5 209.9c-44 .1-87-13.6-122.8-39.2l0 178.7c0 33.1-10.1 65.4-29 92.6s-45.6 48-76.6 59.6-64.8 13.5-96.9 5.3-60.9-25.9-82.7-50.8-35.3-56-39-88.9 2.9-66.1 18.6-95.2 40-52.7 69.6-67.7 62.9-20.5 95.7-16l0 89.9c-15-4.7-31.1-4.6-46 .4s-27.9 14.6-37 27.3-14 28.1-13.9 43.9 5.2 31 14.5 43.7 22.4 22.1 37.4 26.9 31.1 4.8 46-.1 28-14.4 37.2-27.1 14.2-28.1 14.2-43.8l0-349.4 88 0c-.1 7.4 .6 14.9 1.9 22.2 3.1 16.3 9.4 31.9 18.7 45.7s21.3 25.6 35.2 34.6c19.9 13.1 43.2 20.1 67 20.1l0 87.4z"
    />
  );
}

export function ThreadsIcon({ className }: LandingIconProps) {
  return (
    <BrandSocialIcon
      className={className}
      path="M340.8 238c-.6-69.6-38.3-111.5-102-111.5-42.5 0-78.3 19.2-97.1 49.9l41.2 28.7c10.7-16.8 25.4-30.8 52.4-30.8 30.5 0 46.3 17 50.8 48.5-14.7-2.3-29.5-3.5-44.6-3.5-82.4 0-121.1 37.3-121.1 86.6s38.8 79.7 95.9 79.7c62.7 0 100.1-42.2 115.4-94.5 15.9 7.2 26.9 24 26.9 49.3 0 67.6-78 104.5-144.1 104.5-97.5 0-161.3-64-161.3-168.2 0-127.6 84.3-209.4 197.6-209.4 76 0 113.6 33.4 139.2 78.1L432 115.9c-27.8-58-89.9-99.5-183.1-99.5-148.5 0-249.5 105.4-249.5 258.2 0 139.8 98.9 220.9 216.7 220.9 97.4 0 195.8-56.8 195.8-154 0-50.8-29.2-84.5-71.2-103.5zM214.4 334.9c-21.5 0-40.4-10.2-40.4-29 0-29.6 36.4-38.6 72-38.6 13.5 0 26.8 .9 38.5 3.5-8.4 38.5-33.4 64.2-70 64.2l0 0z"
    />
  );
}

export const FRAMEZOO_TIKTOK_URL = "https://www.tiktok.com/@framezoo.top";
export const FRAMEZOO_THREADS_URL = "https://www.threads.com/@framezoo.top";

export const FRAMEZOO_SOCIAL_LINKS = [
  {
    href: FRAMEZOO_TIKTOK_URL,
    label: "TikTok",
    ariaLabel: "Framezoo TikTok",
    title: "TikTok (@framezoo.top)",
    Icon: TikTokIcon,
  },
  {
    href: FRAMEZOO_THREADS_URL,
    label: "Threads",
    ariaLabel: "Framezoo Threads",
    title: "Threads (@framezoo.top)",
    Icon: ThreadsIcon,
  },
] as const;
