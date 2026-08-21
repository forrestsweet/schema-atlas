"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function ThinkingIndicator({
  as: Component = "div",
  label,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "label"> & {
  as?: "div" | "span";
  label: string;
}) {
  return (
    <Component
      className={cn(
        "text-foreground/55 flex items-center gap-2.5 text-sm",
        className,
      )}
      data-slot="thinking-indicator"
      {...props}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none dark:bg-blue-400"
      />
      <span
        className="fade-in slide-in-from-bottom-1 animate-in relative inline-block leading-none duration-300"
        key={label}
      >
        <span>{label}</span>
        <span
          aria-hidden
          className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
        >
          {label}
        </span>
      </span>
    </Component>
  );
}
