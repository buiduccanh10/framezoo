import { ReactNode } from "react";

export function Layout(props: { children: ReactNode }) {
  return (
    <div>
      <div className="flex min-h-screen flex-col">{props.children}</div>
    </div>
  );
}
