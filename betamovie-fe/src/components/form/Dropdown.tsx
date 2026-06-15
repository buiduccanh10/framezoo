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

export function Dropdown(props: DropdownProps) {
  const { direction = "down", customButton, customMenu } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoSide, setAutoSide] = useState<"left" | "right">("left");
  const estimatedMenuWidth = useMemo(() => {
    const longestOption = props.options.reduce(
      (max, option) => Math.max(max, option.name.length),
      0,
    );
    return Math.min(420, Math.max(180, longestOption * 9 + 64));
  }, [props.options]);

  const resolveAutoSide = useCallback(() => {
    if (props.side || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const spaceToRight = window.innerWidth - rect.left;
    const spaceToLeft = rect.right;

    if (spaceToRight >= estimatedMenuWidth) {
      setAutoSide("left");
      return;
    }

    if (spaceToLeft >= estimatedMenuWidth) {
      setAutoSide("right");
      return;
    }

    setAutoSide(spaceToRight >= spaceToLeft ? "left" : "right");
  }, [props.side, estimatedMenuWidth]);

  useEffect(() => {
    resolveAutoSide();
    if (props.side) return;

    window.addEventListener("resize", resolveAutoSide);
    return () => window.removeEventListener("resize", resolveAutoSide);
  }, [props.side, resolveAutoSide]);

  const effectiveSide = props.side ?? autoSide;

  return (
    <div
      ref={containerRef}
      className={`relative my-4 w-fit max-w-[25rem] ${props.className}`}
    >
      <Listbox value={props.selectedItem} onChange={props.setSelectedItem}>
        {({ open }) => (
          <>
            {customButton ? (
              <div onMouseDownCapture={resolveAutoSide}>
                <Listbox.Button as={Fragment}>{customButton}</Listbox.Button>
              </div>
            ) : (
              <Listbox.Button
                onMouseDown={resolveAutoSide}
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
            <Transition
              animation="slide-down"
              show={open}
              className={`absolute z-[40] min-w-[20px] w-fit max-h-60 overflow-auto rounded-xl bg-dropdown-background py-1 text-white shadow-lg ring-1 ring-black ring-opacity-5 scrollbar-thin scrollbar-track-background-secondary scrollbar-thumb-type-secondary focus:outline-none ${
                direction === "up" ? "bottom-full mb-4" : "top-full mt-1"
              } ${effectiveSide === "right" ? "right-0" : "left-0"} ${props.menuClassName ?? ""}`}
            >
              {customMenu ? (
                <Listbox.Options static as={Fragment}>
                  {customMenu}
                </Listbox.Options>
              ) : (
                <Listbox.Options static>
                  {props.options.map((opt) => (
                    <Listbox.Option
                      className={({ active }) =>
                        `cursor-pointer flex gap-4 items-center relative select-none py-2 px-4 mx-1 rounded-lg ${
                          active
                            ? "bg-background-secondaryHover text-type-link"
                            : "text-type-secondary"
                        } ${props.preventWrap ? "whitespace-nowrap" : ""}`
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
          </>
        )}
      </Listbox>
    </div>
  );
}
