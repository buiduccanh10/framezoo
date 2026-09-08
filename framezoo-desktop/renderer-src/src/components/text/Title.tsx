import classNames from "classnames";

export function Title(props: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={classNames(
        "text-white/100 text-3xl font-bold mt-6",
        props.className,
      )}
    >
      {props.children}
    </h2>
  );
}
