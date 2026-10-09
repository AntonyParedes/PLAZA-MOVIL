import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'PM Créditos', description: 'Administración de préstamos y cobranzas' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body>{children}</body></html>;
}
