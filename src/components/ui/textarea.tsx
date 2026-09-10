import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-24 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle",
      "transition-shadow duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
      "disabled:opacity-40 resize-none",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
