import type { ReactNode } from "react";

export const metadata = { title: "LLM Gateway" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body
        style={{
          margin: 0,
          padding: "2rem",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          background: "#0f1115",
          color: "#e6e6e6",
        }}
      >
        {children}
      </body>
    </html>
  );
}
