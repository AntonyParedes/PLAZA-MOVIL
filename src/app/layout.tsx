import type { Metadata } from "next";
import localFont from "next/font/local";
import "./tailwind.css";
import "./globals.css";
const geist = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist",
  display: "swap",
  weight: "100 900",
});
export const metadata: Metadata = {
  title: "PM Créditos",
  description: "Administración de préstamos y cobranzas",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
