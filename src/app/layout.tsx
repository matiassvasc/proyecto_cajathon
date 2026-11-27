import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "KipuAI | Cronogramas Inteligentes — Caja Trujillo (CAJATHON 2026)",
  description:
    "Motor financiero Base 360, ingesta multimodal en campo y simulador de estrés climático para planes de pago adaptados al ciclo económico del microempresario peruano.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-PE">
      <body
        className={`${plusJakarta.variable} ${jetbrainsMono.variable} min-h-screen bg-slate-50 text-slate-900 antialiased selection:bg-emerald-100 selection:text-emerald-950`}
      >
        {children}
      </body>
    </html>
  );
}
