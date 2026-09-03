import type { ReactNode } from "react";

export const c = {
  dim: "#8b93a1",
  line: "#23262e",
  ok: "#4ade80",
  bad: "#ff6b6b",
  warn: "#f0a202",
  accent: "#7aa2f7",
};

export function Nav({ here }: { here: string }) {
  const items = [
    ["/", "dashboard"],
    ["/catalog", "catalog"],
    ["/pools", "pools"],
    ["/usage", "usage"],
  ];
  return (
    <nav style={{ display: "flex", gap: "1.2rem", marginBottom: "1.8rem", fontSize: "0.8rem" }}>
      {items.map(([href, label]) => (
        <a
          key={href}
          href={href}
          style={{ color: here === href ? c.accent : c.dim, textDecoration: "none" }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

export const Th = ({ children }: { children?: ReactNode }) => (
  <th style={{ padding: "0.4rem 0.6rem 0.4rem 0", fontWeight: 400, whiteSpace: "nowrap" }}>{children}</th>
);
export const Td = ({ children }: { children?: ReactNode }) => (
  <td style={{ padding: "0.35rem 0.6rem 0.35rem 0", whiteSpace: "nowrap" }}>{children}</td>
);

export const btn: React.CSSProperties = {
  background: "#1b1e26",
  color: "#e6e6e6",
  border: `1px solid ${c.line}`,
  borderRadius: 4,
  padding: "0.25rem 0.55rem",
  fontSize: "0.72rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

export const input: React.CSSProperties = {
  ...btn,
  cursor: "text",
  minWidth: 0,
};

/** VND, and an em dash for "no price published" rather than a misleading 0. */
export const vnd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
