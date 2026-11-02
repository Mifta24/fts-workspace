import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-card p-6 text-card-foreground", className)}
      {...props}
    />
  );
}

/** `level` 1 is for a card that is the page's only title (sign-in, invitation); use 2 inside a page that already has an h1. */
export function CardTitle({
  className,
  level = 1,
  ...props
}: ComponentProps<"h1"> & { level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return <Heading className={cn("text-xl font-semibold tracking-tight", className)} {...props} />;
}
