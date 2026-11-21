import { useEffect } from "react";

export function useSlashFocus(ref: { readonly current: HTMLElement | null }) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "/") {
        const activeElement = document.activeElement;
        const activeTag = activeElement?.tagName.toLowerCase();
        if (
          activeTag === "input" ||
          activeTag === "textarea" ||
          (activeElement instanceof HTMLElement &&
            activeElement.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        ref.current?.focus();
      }
    };

    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [ref]);
}
