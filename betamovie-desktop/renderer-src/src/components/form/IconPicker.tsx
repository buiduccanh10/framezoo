import classNames from "classnames";
import { useEffect, useState } from "react";

import { UserIcon, UserIcons } from "../UserIcon";

const classicIcons = [
  UserIcons.CAT,
  UserIcons.WEED,
  UserIcons.USER_GROUP,
  UserIcons.COUCH,
  UserIcons.MOBILE,
  UserIcons.TICKET,
  UserIcons.SATURN,
  UserIcons.HEADPHONES,
  UserIcons.TV,
  UserIcons.GHOST,
  UserIcons.COFFEE,
  UserIcons.FIRE,
  UserIcons.MEGAPHONE,
  UserIcons.DRAGON,
  UserIcons.RISING_STAR,
  UserIcons.CLOUD_ARROW_UP,
  UserIcons.WAND,
  UserIcons.CLAPPER_BOARD,
  UserIcons.FILM,
  UserIcons.PLAY,
  UserIcons.WATCH_PARTY,
  UserIcons.TACHOMETER,
  UserIcons.CIRCLE_QUESTION,
  UserIcons.BRUSH,
  UserIcons.BELL,
  UserIcons.THUMBS_UP,
];

const emojiIcons = [
  UserIcons.CAT_FACE,
  UserIcons.DOG_FACE,
  UserIcons.FOX_FACE,
  UserIcons.PANDA_FACE,
  UserIcons.KOALA_FACE,
  UserIcons.TIGER_FACE,
  UserIcons.RABBIT_FACE,
  UserIcons.BEAR_FACE,
  UserIcons.MONKEY_FACE,
  UserIcons.PIG_FACE,
  UserIcons.UNICORN_FACE,
  UserIcons.CHICK_FACE,
  UserIcons.FROG_FACE,
  UserIcons.ROBOT_FACE,
  UserIcons.ALIEN_FACE,
  UserIcons.GRINNING_FACE,
  UserIcons.SMILING_FACE,
  UserIcons.JOY_FACE,
  UserIcons.COOL_FACE,
  UserIcons.HEART_EYES_FACE,
  UserIcons.WINK_FACE,
  UserIcons.THINKING_FACE,
  UserIcons.NERD_FACE,
  UserIcons.PLEADING_FACE,
  UserIcons.SLEEPY_FACE,
  UserIcons.ANGEL_FACE,
];

type IconTab = "classic" | "emoji";

export const initialIcon = classicIcons[0];

function getTabForIcon(icon: UserIcons): IconTab {
  return emojiIcons.includes(icon) ? "emoji" : "classic";
}

export function IconPicker(props: {
  label: string;
  value: UserIcons;
  onInput: (v: UserIcons) => void;
}) {
  const [activeTab, setActiveTab] = useState<IconTab>(() =>
    getTabForIcon(props.value),
  );

  useEffect(() => {
    setActiveTab(getTabForIcon(props.value));
  }, [props.value]);

  const icons = activeTab === "classic" ? classicIcons : emojiIcons;

  return (
    <div className="space-y-3">
      {props.label ? (
        <p className="font-bold text-white">{props.label}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={classNames(
            "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            activeTab === "classic"
              ? "bg-buttons-purple text-white"
              : "bg-authentication-inputBg text-type-dimmed hover:text-white",
          )}
          onClick={() => setActiveTab("classic")}
        >
          Classic
        </button>
        <button
          type="button"
          className={classNames(
            "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            activeTab === "emoji"
              ? "bg-buttons-purple text-white"
              : "bg-authentication-inputBg text-type-dimmed hover:text-white",
          )}
          onClick={() => setActiveTab("emoji")}
        >
          Emoji
        </button>
      </div>

      <div className="grid grid-cols-6 gap-3">
        {icons.map((icon) => {
          return (
            <button
              type="button"
              tabIndex={0}
              className={classNames(
                "w-full h-10 rounded flex justify-center items-center text-white pointer border-2 border-opacity-10 cursor-pointer",
                props.value === icon
                  ? "bg-buttons-purple border-white"
                  : "bg-authentication-inputBg border-transparent",
              )}
              onClick={() => props.onInput(icon)}
              key={icon}
            >
              <UserIcon className="text-xl" icon={icon} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
