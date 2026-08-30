export interface StepperProps {
  current: number;
  steps: number;
  className?: string;
}

export function Stepper(props: StepperProps) {
  const percentage = (props.current / props.steps) * 100;

  return (
    <div className={props.className}>
      <p className="mb-2 text-type-secondary font-medium text-sm">
        {props.current}/{props.steps}
      </p>
      <div className="max-w-full h-1 w-32 bg-progress-background/30 rounded-full overflow-hidden">
        <div
          className="h-full bg-progress-filled transition-[width] rounded-full"
          style={{
            width: `${percentage.toFixed(0)}%`,
          }}
        />
      </div>
    </div>
  );
}
