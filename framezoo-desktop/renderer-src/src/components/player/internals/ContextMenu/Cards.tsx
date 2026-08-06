import classNames from "classnames";

export function Card(props: { children: React.ReactNode }) {
  return (
    <div className="h-full grid grid-rows-[1fr]">
      <div className="px-6 h-full flex flex-col justify-start overflow-y-auto overflow-x-hidden pb-4 scrollbar-none">
        {props.children}
      </div>
    </div>
  );
}

export function CardWithScrollable(props: {
  children: React.ReactNode;
  scrollLastChild?: boolean;
}) {
  return (
    <div
      className={classNames(
        "[&>*]:px-6 h-full grid",
        props.scrollLastChild
          ? "min-h-0 grid-rows-[auto,auto,minmax(0,1fr)] [&>*:nth-child(3)]:min-h-0 [&>*:nth-child(3)]:overflow-y-auto [&>*:nth-child(3)]:overflow-x-hidden"
          : "grid-rows-[auto,1fr] [&>*:nth-child(2)]:overflow-y-auto [&>*:nth-child(2)]:overflow-x-hidden",
      )}
    >
      {props.children}
    </div>
  );
}
