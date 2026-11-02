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

export function CardTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("text-xl font-semibold tracking-tight", className)} {...props} />;
}
