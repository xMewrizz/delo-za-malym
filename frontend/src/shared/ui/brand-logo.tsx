export function BrandLogo({ width = 224 }: { width?: number }) {
  return <span className="brand-logo" style={{ width }}><img className="brand-logo-on-light" src="/brand/logo.svg" alt="Дело за малым." width={width} height="44" /><img className="brand-logo-on-dark" src="/brand/logo-dark-color.svg" alt="Дело за малым." width={width} height="44" /></span>;
}
