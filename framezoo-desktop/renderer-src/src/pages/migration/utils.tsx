import classNames from "classnames";
import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Icon, Icons } from "@/components/Icon";
import { Heading2, Heading3, Paragraph } from "@/components/utils/Text";

export function Card(props: {
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={classNames(
        {
          "bg-settings-card-background duration-300 border border-settings-card-border rounded-xl p-7 shadow-lg": true,
          "hover:bg-settings-card-altBackground hover:border-type-link/40 transition-all cursor-pointer":
            !!props.onClick,
        },
        props.className,
      )}
      onClick={props.onClick}
    >
      {props.children}
    </div>
  );
}

export function CardContent(props: {
  title: ReactNode;
  description: ReactNode;
  subtitle: ReactNode;
  colorClass?: string;
  children?: React.ReactNode;
  icon: Icons;
}) {
  const accentClass = props.colorClass ?? "text-type-link";
  return (
    <div className="grid grid-rows-[1fr,auto] h-full">
      <div>
        <Icon
          icon={props.icon}
          className={classNames("text-4xl mb-8 block", accentClass)}
        />
        <Heading3
          className={classNames(
            "!mt-0 !mb-0 !text-xs uppercase tracking-wider font-bold",
            accentClass,
          )}
        >
          {props.subtitle}
        </Heading3>
        <Heading2 className="!mb-0 !mt-1 !text-base">{props.title}</Heading2>
        <Paragraph className="max-w-[320px] !my-4">
          {props.description}
        </Paragraph>
      </div>
      <div>{props.children}</div>
    </div>
  );
}

export function Link(props: {
  children?: React.ReactNode;
  to?: string;
  href?: string;
  className?: string;
  target?: "_blank";
}) {
  const navigate = useNavigate();
  return (
    <a
      onClick={() => {
        if (props.to) navigate(props.to);
      }}
      href={props.href}
      target={props.target}
      className={classNames(
        "text-type-link font-medium cursor-pointer inline-flex gap-2 items-center group hover:text-type-linkHover transition-colors",
        props.className,
      )}
      rel="noreferrer"
    >
      {props.children}
      <Icon
        icon={Icons.ARROW_RIGHT}
        className="group-hover:translate-x-0.5 transition-transform text-xl group-active:translate-x-0"
      />
    </a>
  );
}
