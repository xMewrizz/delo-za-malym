export function BrandLogo({ width = 224 }: { width?: number }) {
  return <span className="brand-logo" style={{ width }}>
    <svg className="brand-logo-symbol" viewBox="60 52 400 400" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M276 80H156A80 80 0 0 0 76 160V356A80 80 0 0 0 156 436H356A80 80 0 0 0 436 356V236A20 20 0 0 0 416 216H380A20 20 0 0 0 360 236V328A28 28 0 0 1 332 356H184A28 28 0 0 1 156 328V184A28 28 0 0 1 184 156H276A20 20 0 0 0 296 136V100A20 20 0 0 0 276 80Z" />
      <rect x="328" y="68" width="116" height="116" rx="26" />
    </svg>
    <span className="brand-logo-wordmark"><img className="brand-logo-on-light" src="/brand/wordmark.svg" alt="Дело за малым." width="770" height="96" /><img className="brand-logo-on-dark" src="/brand/wordmark-white.svg" alt="Дело за малым." width="770" height="96" /></span>
  </span>;
}
