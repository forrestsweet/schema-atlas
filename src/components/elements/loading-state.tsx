"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type GenerationLoaderVariant = "dots" | "squares" | "rounded";

export interface GenerationLoaderProps extends Omit<
  ComponentProps<"div">,
  "children"
> {
  label: string;
  tick: number;
  variant?: GenerationLoaderVariant;
}

const CELL_SHAPES: Record<GenerationLoaderVariant, string> = {
  dots: "rounded-full",
  squares: "rounded-[1px]",
  rounded: "rounded-[3px]",
};

export function GenerationLoader({
  label,
  tick,
  variant = "dots",
  className,
  ...props
}: GenerationLoaderProps) {
  const pixelOffset = Math.floor(tick / 3);

  return (
    <div
      className={cn("flex items-center gap-2", className)}
      data-slot="generation-loader"
      {...props}
    >
      <div aria-hidden className="grid shrink-0 grid-cols-3 gap-0.5">
        {Array.from({ length: 9 }, (_, index) => {
          const active = (index * 2 + pixelOffset) % 9 < 3;

          return (
            <span
              className={cn(
                "bg-foreground size-1 transition-opacity duration-300 motion-reduce:transition-none",
                CELL_SHAPES[variant],
                active ? "opacity-90" : "opacity-15",
              )}
              key={index}
            />
          );
        })}
      </div>
      <span className="text-foreground/55 relative inline-block text-sm">
        <span>{label}</span>
        <span
          aria-hidden
          className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
        >
          {label}
        </span>
      </span>
    </div>
  );
}
