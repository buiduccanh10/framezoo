import { Icon, Icons } from "@/components/Icon";

export interface IconPatchProps {
  active?: boolean;
  onClick?: () => void;
  clickable?: boolean;
  className?: string;
  icon: Icons;
  transparent?: boolean;
  downsized?: boolean;
  navigation?: boolean;
}

export function IconPatch(props: IconPatchProps) {
  const backgroundClasses = props.transparent
    ? props.clickable
      ? "bg-pill-background/0 hover:bg-pill-backgroundHover/50"
      : "bg-pill-background/0"
    : props.navigation
      ? "bg-pill-background/50 hover:bg-pill-backgroundHover/100"
      : "bg-pill-background/100";
  const clickableClasses = props.clickable
    ? "cursor-pointer hover:scale-110 hover:text-white active:scale-125"
    : "";
  const activeClasses = props.active
    ? "bg-pill-backgroundHover/100 text-white"
    : "";
  const sizeClasses = props.downsized ? "h-10 w-10" : "h-12 w-12";

  return (
    <div className={props.className || undefined} onClick={props.onClick}>
      <div
        className={`flex items-center justify-center rounded-full border-2 border-transparent transition-[background-color,color,transform,border-color] duration-75 ${backgroundClasses} ${clickableClasses} ${activeClasses} ${sizeClasses}`}
      >
        <Icon icon={props.icon} />
      </div>
    </div>
  );
}
