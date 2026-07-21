import classNames from "classnames";
import { forwardRef } from "react";

import { Icon, Icons } from "@/components/Icon";

export interface VideoPlayerButtonProps {
  children?: React.ReactNode;
  onClick?: (el: HTMLButtonElement) => void;
  icon?: Icons;
  iconSizeClass?: string;
  className?: string;
  activeClass?: string;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  title?: string;
}

export const VideoPlayerButton = forwardRef<
  HTMLButtonElement,
  VideoPlayerButtonProps
>((props, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => props.onClick?.(e.currentTarget as HTMLButtonElement)}
      aria-label={props["aria-label"]}
      aria-expanded={props["aria-expanded"]}
      title={props.title}
      className={classNames([
        "tabbable p-3 rounded-full hover:bg-video-buttonBackground hover:bg-opacity-50 transition-transform duration-100 flex items-center justify-center",
        props.activeClass ??
          "active:scale-110 active:bg-opacity-75 active:text-white",
        props.className ?? "",
      ])}
    >
      {props.icon && (
        <Icon
          className={props.iconSizeClass || "text-[32px]"}
          icon={props.icon}
        />
      )}
      {props.children}
    </button>
  );
});
