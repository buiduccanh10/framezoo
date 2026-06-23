import { Listbox } from "@headlessui/react";
import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Icon, Icons } from "@/components/Icon";
import { Transition } from "@/components/utils/Transition";

export interface OptionItem {
  id: string;
  name: string;
  leftIcon?: React.ReactNode;
}

interface DropdownProps {
  selectedItem: OptionItem;
  setSelectedItem: (value: OptionItem) => void;
  options: Array<OptionItem>;
  direction?: "up" | "down";
  side?: "left" | "right";
  customButton?: React.ReactNode;
  customMenu?: React.ReactNode;
  className?: string;
  menuClassName?: string;
  preventWrap?: boolean;
}

const VIEWPORT_PADDING = 16;

function getMenuLeftOffset(
  containerRect: DOMRect,
  menuWidth: number,
  forcedSide?: "left" | "right",
) {
  const fitsOnLeft =
    containerRect.left + menuWidth <= window.innerWidth - VIEWPORT_PADDING;
  const fitsOnRight = containerRect.right - menuWidth >= VIEWPORT_PADDING;
  const resolvedSide =
    forcedSide ??
    (fitsOnLeft
      ? "left"
      : fitsOnRight
        ? "right"
        : window.innerWidth - containerRect.left >= containerRect.right
          ? "left"
          : "right");

  const desiredLeft =
    resolvedSide === "right" ? containerRect.width - menuWidth : 0;
  const minLeft = VIEWPORT_PADDING - containerRect.left;
  const maxLeft =
    window.innerWidth - VIEWPORT_PADDING - containerRect.left - menuWidth;

  if (maxLeft < minLeft) {
    return minLeft;
  }

  return Math.min(Math.max(desiredLeft, minLeft), maxLeft);
}

interface DropdownMenuProps {
  open: boolean;
  direction: "up" | "down";
  side?: "left" | "right";
  containerRef: React.RefObject<HTMLDivElement | null>;
  estimatedMenuWidth: number;
  menuClassName?: string;
  customMenu?: React.ReactNode;
  options: Array<OptionItem>;
  preventWrap?: boolean;
  initialLeft: number;
}

function DropdownMenu({
  open,
  direction,
  side,
  containerRef,
  estimatedMenuWidth,
  menuClassName,
  customMenu,
  options,
  preventWrap,
  initialLeft,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuLeft, setMenuLeft] = useState(initialLeft);

  const resolveMenuPosition = useCallback(
    (fallbackWidth?: number) => {
      if (!containerRef.current) return;

      const menuWidth =
        menuRef.current?.getBoundingClientRect().width ||
        fallbackWidth ||
        estimatedMenuWidth;

      const nextLeft = getMenuLeftOffset(
        containerRef.current.getBoundingClientRect(),
        menuWidth,
        side,
      );

      setMenuLeft((currentLeft) =>
        Math.abs(currentLeft - nextLeft) < 1 ? currentLeft : nextLeft,
      );
    },
    [containerRef, estimatedMenuWidth, side],
  );

  useEffect(() => {
    if (!open) return;
    setMenuLeft(initialLeft);
  }, [initialLeft, open]);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => resolveMenuPosition();
    const animationFrame = window.requestAnimationFrame(updatePosition);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updatePosition);

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      if (menuRef.current) {
        resizeObserver.observe(menuRef.current);
      }
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [containerRef, open, resolveMenuPosition]);

  return (
    <div
      ref={menuRef}
      className={`absolute z-[40] max-w-[calc(100vw-2rem)] ${
        direction === "up" ? "bottom-full mb-4" : "top-full mt-1"
      }`}
      style={{ left: open ? menuLeft : initialLeft }}
    >
      <Transition
        animation="slide-down"
        show={open}
        className={`min-w-[20px] w-fit max-w-[calc(100vw-2rem)] max-h-60 overflow-auto rounded-xl bg-dropdown-background py-1 text-white shadow-lg ring-1 ring-black ring-opacity-5 scrollbar-thin scrollbar-track-background-secondary scrollbar-thumb-type-secondary focus:outline-none ${
          menuClassName ?? ""
        }`}
      >
        {customMenu ? (
          <Listbox.Options static as={Fragment}>
            {customMenu}
          </Listbox.Options>
        ) : (
          <Listbox.Options static>
            {options.map((opt) => (
              <Listbox.Option
                className={({ active }) =>
                  `cursor-pointer flex gap-4 items-center relative select-none py-2 px-4 mx-1 rounded-lg ${
                    active
                      ? "bg-background-secondaryHover text-type-link"
                      : "text-type-secondary"
                  } ${preventWrap ? "whitespace-nowrap" : ""}`
                }
                key={opt.id}
                value={opt}
              >
                {opt.leftIcon ? opt.leftIcon : null}
                {opt.name}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        )}
      </Transition>
    </div>
  );
}

export function Dropdown(props: DropdownProps) {
  const { direction = "down", customButton, customMenu } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [initialMenuLeft, setInitialMenuLeft] = useState(0);
  const estimatedMenuWidth = useMemo(() => {
    const longestOption = props.options.reduce(
      (max, option) => Math.max(max, option.name.length),
      0,
    );
    return Math.min(420, Math.max(180, longestOption * 9 + 64));
  }, [props.options]);

  const resolveInitialMenuPosition = useCallback(() => {
    if (!containerRef.current) return;

    const nextLeft = getMenuLeftOffset(
      containerRef.current.getBoundingClientRect(),
      estimatedMenuWidth,
      props.side,
    );

    setInitialMenuLeft(nextLeft);
  }, [props.side, estimatedMenuWidth]);

  useEffect(() => {
    resolveInitialMenuPosition();
    window.addEventListener("resize", resolveInitialMenuPosition);
    return () =>
      window.removeEventListener("resize", resolveInitialMenuPosition);
  }, [resolveInitialMenuPosition]);

  return (
    <div
      ref={containerRef}
      className={`relative my-4 w-fit max-w-[25rem] ${props.className}`}
    >
      <Listbox value={props.selectedItem} onChange={props.setSelectedItem}>
        {({ open }) => (
          <>
            {customButton ? (
              <div onMouseDownCapture={resolveInitialMenuPosition}>
                <Listbox.Button as={Fragment}>{customButton}</Listbox.Button>
              </div>
            ) : (
              <Listbox.Button
                onMouseDown={resolveInitialMenuPosition}
                className="relative z-[30] w-full rounded-xl bg-dropdown-background hover:bg-dropdown-hoverBackground py-2 pl-3 pr-10 text-left text-white shadow-md focus:outline-none tabbable cursor-pointer"
              >
                <span className="flex gap-4 items-center truncate">
                  {props.selectedItem.leftIcon
                    ? props.selectedItem.leftIcon
                    : null}
                  {props.selectedItem.name}
                </span>
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                  <Icon
                    icon={Icons.UP_DOWN_ARROW}
                    className={`transform transition-transform text-xl text-dropdown-secondary ${direction === "up" ? "rotate-180" : ""}`}
                  />
                </span>
              </Listbox.Button>
            )}
            <DropdownMenu
              open={open}
              direction={direction}
              side={props.side}
              containerRef={containerRef}
              estimatedMenuWidth={estimatedMenuWidth}
              menuClassName={props.menuClassName}
              customMenu={customMenu}
              options={props.options}
              preventWrap={props.preventWrap}
              initialLeft={initialMenuLeft}
            />
          </>
        )}
      </Listbox>
    </div>
  );
}
