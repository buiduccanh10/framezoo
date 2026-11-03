import { useEffect, useRef } from "react";

export function OtpInput(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  length?: number;
  autoFocus?: boolean;
  label?: string;
}) {
  const length = props.length ?? 6;
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (props.autoFocus) refs.current[0]?.focus();
  }, [props.autoFocus]);

  const setValue = (value: string, focusIndex?: number) => {
    const digits = value.replace(/\D/g, "").slice(0, length);
    props.onChange(digits);
    if (focusIndex !== undefined) refs.current[focusIndex]?.focus();
  };

  return (
    <div className="space-y-3">
      {props.label ? (
        <p className="font-bold text-white">{props.label}</p>
      ) : null}
      <div
        className="flex justify-center gap-2"
        role="group"
        aria-label={props.label}
      >
        {Array.from({ length }, (_, index) => (
          <input
            key={index}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={length}
            value={props.value[index] ?? ""}
            disabled={props.disabled}
            aria-label={`Verification digit ${index + 1}`}
            className="h-12 w-10 rounded-lg bg-authentication-inputBg text-center text-xl font-bold text-white outline-none ring-1 ring-transparent focus:ring-buttons-purple"
            onChange={(event) => {
              const entered = event.target.value.replace(/\D/g, "");
              if (!entered) {
                const next = props.value.split("");
                next[index] = "";
                setValue(next.join(""));
                return;
              }

              if (entered.length > 1) {
                setValue(entered, Math.min(index + entered.length, length - 1));
                return;
              }

              const next = props.value.split("");
              next[index] = entered;
              setValue(
                next.join(""),
                index < length - 1 ? index + 1 : undefined,
              );
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Backspace" &&
                !props.value[index] &&
                index > 0
              ) {
                refs.current[index - 1]?.focus();
              }
              if (event.key === "ArrowLeft" && index > 0) {
                event.preventDefault();
                refs.current[index - 1]?.focus();
              }
              if (event.key === "ArrowRight" && index < length - 1) {
                event.preventDefault();
                refs.current[index + 1]?.focus();
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData.getData("text");
              const digits = pasted.replace(/\D/g, "").slice(0, length);
              if (!digits) return;
              setValue(digits, Math.min(digits.length - 1, length - 1));
            }}
          />
        ))}
      </div>
    </div>
  );
}
