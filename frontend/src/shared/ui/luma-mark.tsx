import type { CSSProperties } from "react";
import "./luma.css";

export function LumaMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return <img className={`luma-mark ${className}`} src="/brand/luma-glint.png" width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}

export function LumaAvatar({ size = 44, active = false, className = "" }: { size?: number; active?: boolean; className?: string }) {
  return <span className={`luma-avatar ${className}`} data-active={active} style={{ "--luma-size": `${size}px` } as CSSProperties} aria-hidden="true"><LumaMark size={size} /></span>;
}
