import type { ReactNode } from "react";

const LINKS = [
  ["/", "Tổng quan"],
  ["/catalog", "Danh mục"],
  ["/pools", "Pool"],
  ["/usage", "Chi tiêu"],
] as const;

export function Nav({ here }: { here: string }) {
  return (
    <nav className="nav">
      <span className="brand">
        <span className="dot" />
        LLM Gateway
      </span>
      {LINKS.map(([href, label]) => (
        <a key={href} href={href} {...(here === href ? { "aria-current": "page" } : {})}>
          {label}
        </a>
      ))}
    </nav>
  );
}

export function Shell({ here, children }: { here: string; children: ReactNode }) {
  return (
    <div className="shell">
      <Nav here={here} />
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const color = tone ? `var(--${tone})` : undefined;
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>
        <span className="mono">{value}</span>
        {/* The unit sits outside the monospace run: JetBrains Mono has no ₫ and
            falls back mid-number, which reads as a stray letter. */}
        {unit && <span style={{ fontSize: "0.62em", marginLeft: 4, opacity: 0.75 }}>{unit}</span>}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: "ok" | "warn" | "bad" | "neutral" | "accent";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

/** VND, with an em dash for "no price published" rather than a misleading 0. */
export const vnd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

export const secs = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)}s`;
