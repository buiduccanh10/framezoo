import { useCallback } from "react";

import { Icons } from "@/components/Icon";
import { useAuth } from "@/hooks/auth/useAuth";
import { useBookmarkStore } from "@/stores/bookmarks";
import { useOverlayStack } from "@/stores/interface/overlayStack";
import { usePlayerStore } from "@/stores/player/store";

import { VideoPlayerButton } from "./Button";

export function BookmarkButton() {
  const { loggedIn } = useAuth();
  const showModal = useOverlayStack((s) => s.showModal);

  const addBookmark = useBookmarkStore((s) => s.addBookmark);
  const removeBookmark = useBookmarkStore((s) => s.removeBookmark);
  const bookmarks = useBookmarkStore((s) => s.bookmarks);
  const meta = usePlayerStore((s) => s.meta);
  const isBookmarked = !!bookmarks[meta?.tmdbId ?? ""];

  const toggleBookmark = useCallback(() => {
    if (!loggedIn) {
      showModal("auth", { mode: "login" });
      return;
    }

    if (!meta) return;
    if (isBookmarked) removeBookmark(meta.tmdbId);
    else addBookmark(meta);
  }, [loggedIn, isBookmarked, meta, addBookmark, removeBookmark, showModal]);

  return (
    <VideoPlayerButton
      onClick={() => toggleBookmark()}
      icon={isBookmarked ? Icons.BOOKMARK : Icons.BOOKMARK_OUTLINE}
      iconSizeClass="text-base"
      className="p-2"
    />
  );
}
