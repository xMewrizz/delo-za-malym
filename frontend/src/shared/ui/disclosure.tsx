import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";
import "./disclosure.css";

export function Disclosure({ title, description, className, children, ...props }: ComponentProps<"details"> & { title: string; description?: string }) {
  return <details {...props} className={cn("ui-disclosure", className)}>
    <summary><span><strong>{title}</strong>{description && <small>{description}</small>}</span><span className="ui-disclosure-toggle" aria-hidden="true" /></summary>
    <div className="ui-disclosure-content">{children}</div>
  </details>;
}
