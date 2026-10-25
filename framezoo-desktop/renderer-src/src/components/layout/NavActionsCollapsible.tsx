import classNames from "classnames";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { IconPatch } from "@/components/buttons/IconPatch";
import { Icon, Icons } from "@/components/Icon";
import { WatchPartyInputLink } from "@/components/LinksDropdown";
import { useOverlayStack } from "@/stores/interface/overlayStack";

import { AddonManager } from "./AddonManager";

export function NavActionsCollapsible() {
  const location = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsExpanded(true);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
    }, 200);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className="relative flex items-center h-14 py-2 -my-2"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* 
        Menu Anchor Button
        Always visible. When hovered, the hamburger icon rotates 90 degrees ("xoay ngang").
      */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="relative z-10 shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg cursor-pointer flex items-center justify-center overflow-visible"
        aria-label="Menu tiện ích"
        title="Menu tiện ích"
      >
        <div
          className={classNames(
            "transition-transform duration-300 ease-out flex items-center justify-center",
            isExpanded ? "rotate-90" : "rotate-0",
          )}
        >
          <IconPatch
            icon={Icons.MENU}
            clickable
            downsized
            navigation
            active={isExpanded}
          />
        </div>
      </button>

      {/* 
        The 4 Buttons emerging/sliding out horizontally from the Menu Button
      */}
      <div
        className={classNames(
          "flex items-center gap-1.5 sm:gap-2 transition-all duration-300 ease-out origin-left py-2 -my-2",
          isExpanded
            ? "max-w-[320px] opacity-100 pointer-events-auto translate-x-0 pl-1.5 sm:pl-2"
            : "max-w-0 opacity-0 pointer-events-none -translate-x-5 pl-0",
        )}
        style={{
          overflow: isExpanded ? "visible" : "hidden",
        }}
      >
        {/* Subtle connector / separator line indicating emergence from menu */}
        <div
          className={classNames(
            "w-[1px] h-4 bg-white/20 shrink-0 transition-opacity duration-200",
            isExpanded ? "opacity-100" : "opacity-0",
          )}
        />

        {/* 1. Search / Discover Button */}
        <div className="shrink-0 flex items-center justify-center overflow-visible" title="Tìm kiếm">
          {location.pathname === "/discover" ? (
            <Link
              to="/browse"
              onClick={() => window.scrollTo(0, 0)}
              className="shrink-0 text-lg text-white tabbable rounded-full backdrop-blur-lg flex items-center justify-center overflow-visible"
              title="Tìm kiếm"
            >
              <IconPatch icon={Icons.SEARCH} clickable downsized navigation />
            </Link>
          ) : (
            <Link
              to="/discover"
              onClick={() => window.scrollTo(0, 0)}
              className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg flex items-center justify-center overflow-visible"
              title="Khám phá"
            >
              <IconPatch icon={Icons.RISING_STAR} clickable downsized navigation />
            </Link>
          )}
        </div>

        {/* 2. Watch Party Button */}
        <div className="shrink-0 flex items-center justify-center overflow-visible" title="Xem cùng bạn bè">
          <WatchPartyInputLink />
        </div>

        {/* 3. Addon Manager Button */}
        <div className="shrink-0 flex items-center justify-center overflow-visible" title="Tiện ích bổ sung">
          <AddonManager>
            {(open) => (
              <button
                type="button"
                onClick={open}
                className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg cursor-pointer flex items-center justify-center overflow-visible"
                title="Tiện ích bổ sung"
                aria-label="Tiện ích bổ sung"
              >
                <IconPatch icon={Icons.EXTENSION} clickable downsized navigation />
              </button>
            )}
          </AddonManager>
        </div>

        {/* 4. Feedback Button */}
        <div className="shrink-0 flex items-center justify-center overflow-visible" title="Gửi phản hồi">
          <button
            type="button"
            onClick={() => useOverlayStack.getState().showModal("feedback")}
            className="shrink-0 text-xl text-white tabbable rounded-full backdrop-blur-lg cursor-pointer flex items-center justify-center overflow-visible"
            title="Gửi phản hồi"
            aria-label="Gửi phản hồi"
          >
            <IconPatch icon={Icons.FEEDBACK} clickable downsized navigation />
          </button>
        </div>
      </div>
    </div>
  );
}
