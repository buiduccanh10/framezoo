import c from "classnames";
import { type ReactNode, forwardRef, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Flare } from "@/components/utils/Flare";

import { Icon, Icons } from "../Icon";
import { TextInputControl } from "../text-inputs/TextInputControl";

export interface SearchBarProps {
  placeholder?: string;
  onChange: (value: string, force: boolean) => void;
  onUnFocus: (newSearch?: string) => void;
  value: string;
  isSticky?: boolean;
  isInFeatured?: boolean;
  aiMode?: boolean;
  onAiModeChange?: (enabled: boolean) => void;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const SearchBarInput = forwardRef<HTMLInputElement, SearchBarProps>(
  (props, ref) => {
    const { t } = useTranslation();
    const [focused, setFocused] = useState(false);
    const [lightTheme, setLightTheme] = useState(
      Boolean(props.isInFeatured) && window.scrollY < 600,
    );
    const containerRef = useRef<HTMLDivElement>(null!);
    const showAiSwitch = Boolean(props.onAiModeChange);
    const isAiMode = showAiSwitch && Boolean(props.aiMode);

    function setSearch(value: string) {
      props.onChange(value, true);
    }

    useEffect(() => {
      const handleScroll = () => {
        setLightTheme(Boolean(props.isInFeatured) && window.scrollY < 600);
      };
      window.addEventListener("scroll", handleScroll);
      return () => window.removeEventListener("scroll", handleScroll);
    }, [props.isInFeatured]);

    return (
      <div
        ref={containerRef}
        className={props.className}
        style={
          {
            WebkitAppRegion: "no-drag",
            ...props.style,
          } as React.CSSProperties
        }
        onClick={(e) => {
          if (
            ref &&
            typeof ref !== "function" &&
            ref.current &&
            e.target !== ref.current
          ) {
            ref.current.focus();
          }
        }}
      >
        <Flare.Base
          className={c({
            "group flex flex-col rounded-[28px] transition-[background-color,box-shadow] duration-300 ease-out sm:flex-row sm:items-center relative backdrop-blur-sm": true,
            "hover:flare-enabled": !isAiMode,
            "shadow-[0_14px_38px_rgba(0,0,0,0.45)]": props.isSticky,
            "shadow-none": !props.isSticky,
            "bg-search-background/50": !focused && lightTheme,
            "bg-search-background":
              focused || props.isSticky || !props.isInFeatured,
          })}
        >
          {isAiMode ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px] motion-safe:animate-fade-in"
            >
              <div
                className={c(
                  "ai-search-border-beam transition-opacity duration-300",
                  focused ? "opacity-100" : "opacity-65 group-hover:opacity-95",
                )}
              />
              <div
                className={c(
                  "absolute inset-[1.5px] rounded-[26.5px] transition-colors duration-300",
                  focused ? "bg-search-focused" : "bg-search-background",
                )}
              />
            </div>
          ) : (
            <Flare.Light
              flareSize={400}
              enabled={focused}
              className="rounded-[28px]"
              backgroundClass={c({
                "transition-colors": true,
                "bg-search-background": !focused,
                "bg-search-focused": focused,
              })}
            />
          )}
          <Flare.Child className="flex flex-1 flex-col">
            <div className="relative flex w-full items-center">
              {showAiSwitch ? (
                <div
                  className="absolute bottom-0 left-2.5 top-0 flex max-h-14 items-center z-10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="relative flex items-center gap-0.5 rounded-full bg-white/5 p-1 border border-white/10">
                    <span
                      aria-hidden="true"
                      className={c(
                        "pointer-events-none absolute left-1 top-1 h-8 w-8 rounded-full bg-type-logo/20 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                        isAiMode ? "translate-x-[34px]" : "translate-x-0",
                      )}
                    />
                    <button
                      type="button"
                      aria-label={t("home.search.switchToNormal", {
                        defaultValue: "Switch to standard search",
                      })}
                      title={t("home.search.switchToNormal", {
                        defaultValue: "Switch to standard search",
                      })}
                      aria-pressed={!isAiMode}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isAiMode) {
                          props.onAiModeChange?.(false);
                        }
                        if (ref && typeof ref !== "function" && ref.current) {
                          ref.current.focus();
                        }
                      }}
                      className={c(
                        "relative z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-200",
                        !isAiMode
                          ? "text-type-logo"
                          : "text-white/60 hover:text-white/90",
                      )}
                    >
                      <Icon icon={Icons.SEARCH} className="text-sm" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("home.search.switchToAi", {
                        defaultValue: "Switch to AI natural language search",
                      })}
                      title={t("home.search.switchToAi", {
                        defaultValue: "Switch to AI natural language search",
                      })}
                      aria-pressed={isAiMode}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!isAiMode) {
                          props.onAiModeChange?.(true);
                        }
                        if (ref && typeof ref !== "function" && ref.current) {
                          ref.current.focus();
                        }
                      }}
                      className={c(
                        "relative z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-200",
                        isAiMode
                          ? "text-type-logo"
                          : "text-white/60 hover:text-white/90",
                      )}
                    >
                      <Icon icon={Icons.AI_SPARKLES} className="text-sm" />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={c(
                    "absolute bottom-0 left-5 top-0 flex max-h-14 items-center text-search-icon cursor-pointer z-10",
                    "transition-colors duration-300",
                    props.isInFeatured
                      ? lightTheme
                        ? "text-white/50"
                        : ""
                      : "text-search-icon",
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (ref && typeof ref !== "function" && ref.current) {
                      ref.current.focus();
                    }
                  }}
                >
                  <Icon icon={Icons.SEARCH} />
                </div>
              )}

              <TextInputControl
                ref={ref}
                onUnFocus={() => {
                  setFocused(false);
                  props.onUnFocus();
                }}
                onFocus={() => setFocused(true)}
                onChange={(val) => setSearch(val)}
                value={props.value}
                className={c(
                  "w-full flex-1 bg-transparent px-4 py-4 !text-search-text focus:outline-none sm:py-4 sm:pr-12 transition-colors duration-300",
                  showAiSwitch ? "pl-[6rem]" : "pl-12",
                  "transition-colors duration-300",
                  props.isInFeatured
                    ? lightTheme
                      ? "text-white/50"
                      : "placeholder-search-placeholder"
                    : "placeholder-search-placeholder",
                )}
                placeholder={props.placeholder}
              />

              <div
                aria-hidden={props.value.length === 0}
                onClick={(e) => {
                  if (props.value.length === 0) return;
                  e.stopPropagation();
                  props.onUnFocus("");
                  if (ref && typeof ref !== "function") {
                    ref.current?.focus();
                  }
                }}
                className={c(
                  "absolute bottom-0 right-2 top-0 my-auto flex h-10 w-10 items-center justify-center rounded-full text-search-icon transition-[opacity,transform,background-color,color] duration-200 ease-out motion-reduce:transition-none",
                  props.value.length > 0
                    ? "cursor-pointer opacity-100 scale-100 pointer-events-auto hover:bg-search-hoverBackground hover:text-white active:scale-95"
                    : "pointer-events-none scale-75 opacity-0",
                )}
              >
                <Icon
                  icon={Icons.X}
                  className="transition-colors duration-200"
                />
              </div>
            </div>

            {props.children}
          </Flare.Child>
        </Flare.Base>
      </div>
    );
  },
);
