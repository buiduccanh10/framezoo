import classNames from "classnames";

export function ActionPillButton(props: {
  className: string;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className={classNames(
        "font-bold rounded h-10 w-40 scale-90 hover:scale-95 transition-all duration-200",
        props.className,
      )}
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}
