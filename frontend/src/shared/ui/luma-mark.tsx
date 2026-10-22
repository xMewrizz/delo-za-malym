import type { CSSProperties } from "react";
import "./luma.css";

export function LumaMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return <svg className={`luma-mark ${className}`} width={size} height={size} viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" focusable="false">
    <path fillRule="evenodd" d="M247 204L247 76L265 76L265 204C265 232 266.606602 232.665476 286.405592 212.866486L328.831998 170.440079L341.559921 183.168002L299.133514 225.594408C279.334524 245.393398 280 247 308 247L436 247L436 265L308 265C280 265 279.334524 266.606602 299.133514 286.405592L341.559921 328.831998L328.831998 341.559921L286.405592 299.133514C266.606602 279.334524 265 280 265 308L265 436L247 436L247 308C247 280 245.393398 279.334524 225.594408 299.133514L183.168002 341.559921L170.440079 328.831998L212.866486 286.405592C232.665476 266.606602 232 265 204 265L76 265L76 247L204 247C232 247 232.665476 245.393398 212.866486 225.594408L170.440079 183.168002L183.168002 170.440079L225.594408 212.866486C245.393398 232.665476 247 232 247 204Z M256 240L272 256L256 272L240 256Z" />
  </svg>;
}

export function LumaAvatar({ size = 44, active = false, className = "" }: { size?: number; active?: boolean; className?: string }) {
  return <span className={`luma-avatar ${className}`} data-active={active} style={{ "--luma-size": `${size}px` } as CSSProperties} aria-hidden="true"><LumaMark size={size} className="luma-mark-glow" /><LumaMark size={size} /></span>;
}
