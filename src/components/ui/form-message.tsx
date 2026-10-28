import { cn } from "@/lib/utils";

/** Screen-reader announced status/error text for forms. */
export function FormMessage({ tone, children }: { tone: "error" | "success"; children?: string }) {
  if (!children) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("text-sm", tone === "error" ? "text-destructive" : "text-success")}
    >
      {children}
    </p>
  );
}
