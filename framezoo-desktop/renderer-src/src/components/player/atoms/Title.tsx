import { usePlayerStore } from "@/stores/player/store";
import { formatSeconds } from "@/utils/formatSeconds";

export function Title() {
  const title = usePlayerStore((s) => s.meta?.title);
  const { time } = usePlayerStore((s) => s.progress);

  const handleTitleClick = (e: React.MouseEvent) => {
    const baseLink = window.location.href;
    const timeStamp = formatSeconds(time, time >= 3600);

    if (e.shiftKey) {
      navigator.clipboard
        .writeText(`${baseLink}?t=${timeStamp}`)
        .then(() => {});
    } else {
      navigator.clipboard.writeText(baseLink).then(() => {});
    }
  };

  if (!title) {
    return (
      <div
        aria-hidden="true"
        className="h-4 w-32 animate-pulse rounded bg-white/15"
      />
    );
  }

  return (
    <p
      onClick={handleTitleClick}
      className="cursor-copy transform truncate transition-transform duration-200 hover:scale-105"
      title="Copy link"
    >
      {title}
    </p>
  );
}
