import { useId } from "react";
import type { Product } from "../api/products";

/** Decorative illustrations share geometry and the site's theme tokens. */
export function ProductArtwork({ productId }: { productId: Product["product_id"] }) {
  const id = useId();
  const face = `url(#${id}-face)`;
  const side = `url(#${id}-side)`;

  return (
    <svg className="product-tile-art" viewBox="0 0 220 170" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-face`} x1="45" y1="30" x2="170" y2="150" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--product-art-highlight)" />
          <stop offset="1" stopColor="var(--product-art-color)" />
        </linearGradient>
        <linearGradient id={`${id}-side`} x1="80" y1="40" x2="170" y2="155" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--product-art-color)" />
          <stop offset="1" stopColor="var(--product-art-shade)" />
        </linearGradient>
      </defs>
      {productId === "working_capital_loan" && (
        <>
          <path className="product-art-guide" d="m18 127 92 39 94-40M110 166v-37" />
          <path d="m41 86 50-23 50 23-50 24Z" fill={face} />
          <path d="M41 86v45l50 23v-44Z" fill={side} />
          <path d="M91 110v44l50-23V86Z" fill="var(--product-art-color)" />
          <path d="m65 75 50 23v17l-12 6v-18L53 81Z" fill="var(--product-art-highlight)" opacity=".55" />
          <path d="m106 47 37-17 37 17-37 17Z" fill={face} />
          <path d="M106 47v34l37 17V64Z" fill={side} />
          <path d="M143 64v34l37-17V47Z" fill="var(--product-art-color)" />
          <path d="m125 39 37 17v13l-9 4V60l-37-17Z" fill="var(--product-art-highlight)" opacity=".55" />
          <path className="product-art-guide" d="M47 51V29m-8 8 8-8 8 8m130 75h17m-6-6 6 6-6 6" />
        </>
      )}
      {productId === "overdraft" && (
        <>
          <rect x="24" y="36" width="120" height="77" rx="13" transform="rotate(-10 24 36)" fill={side} />
          <path d="m40 56 43-8" stroke="var(--product-art-highlight)" strokeWidth="5" strokeLinecap="round" opacity=".7" />
          <rect x="72" y="65" width="120" height="77" rx="13" transform="rotate(7 72 65)" fill={face} />
          <path d="m88 91 28 3m-30 18 61 7" stroke="var(--product-art-ink)" strokeWidth="5" strokeLinecap="round" opacity=".65" />
          <path d="M157 44h26c10 0 17 7 17 17v12m-8-8 8 8 8-8M60 139H36c-10 0-17-7-17-17v-13m-8 8 8-8 8 8" stroke="var(--product-art-color)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="172" cy="131" r="17" fill="var(--product-art-ink)" />
          <path d="m165 131 5 5 9-10" stroke="var(--product-art-highlight)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {productId === "refinancing" && (
        <>
          {[30, 72, 114].map((y) => (
            <g key={y}>
              <rect x="25" y={y} width="60" height="28" rx="7" className="product-art-panel" />
              <path d={`M37 ${y + 14}h26`} className="product-art-guide" />
            </g>
          ))}
          <path d="M92 44h7a15 15 0 0 1 15 15v54a15 15 0 0 1-15 15h-7m0-42h44m-7-7 7 7-7 7" stroke="var(--product-art-color)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="147" y="45" width="52" height="82" rx="10" fill={face} />
          <path d="M160 62h26m-26 9h17" stroke="var(--product-art-ink)" strokeWidth="3" strokeLinecap="round" opacity=".6" />
          <path d="m162 104 7 7 15-17" stroke="var(--product-art-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {productId === "revolving_credit_line" && (
        <>
          <circle cx="110" cy="85" r="66" className="product-art-guide" strokeDasharray="2 8" />
          <path d="M62 61a51 51 0 0 1 91-11m-1-16 1 16-16-1M158 109a51 51 0 0 1-91 11m1 16-1-16 16 1" stroke="var(--product-art-color)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="78" y="63" width="64" height="45" rx="10" fill={face} />
          <path d="M130 78h12v15h-12a7.5 7.5 0 0 1 0-15Z" fill="var(--product-art-ink)" opacity=".65" />
          <circle cx="132" cy="85.5" r="2" fill="var(--product-art-highlight)" />
        </>
      )}
      {productId === "investment_loan" && (
        <>
          <path className="product-art-guide" d="M23 142h177" />
          <rect x="38" y="102" width="36" height="40" rx="5" fill="var(--product-art-color)" opacity=".4" />
          <rect x="92" y="77" width="36" height="65" rx="5" fill={side} />
          <rect x="146" y="45" width="36" height="97" rx="5" fill={face} />
          <path d="m39 82 54-34 33 7 49-32m-17-1 17 1-5 16" stroke="var(--product-art-highlight)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
