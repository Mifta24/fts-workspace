import { cn } from "@/lib/utils";

type Props = {
  /** Percentage from 0 to 100. */
  value: number;
  label: string;
  className?: string;
};

/** Slim four-segment progress bar; fills once on load (not when reduced motion is requested). */
export function ProgressThread({ value, label, className }: Props) {
  const percent = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn(
        "progress-thread h-1.5 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      <div
        className="h-full origin-left rounded-full bg-primary animate-[thread-fill_700ms_ease-out]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
