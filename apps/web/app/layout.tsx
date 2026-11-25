import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider, ThemeScript } from "@/components/theme";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "meteozini — el temps a Catalunya",
  description:
    "Mapa del temps a Catalunya en directe: previsió AROME HD a 1,3 km, més de 300 estacions, radar de pluja i satèl·lit.",
  keywords: [
    "temps Catalunya",
    "previsió temps Catalunya",
    "meteorologia Catalunya",
    "radar pluja Catalunya",
    "models meteorològics Catalunya",
    "AROME Catalunya",
    "estacions meteorològiques Catalunya",
  ],
  authors: [{ name: "meteozini" }],
  creator: "meteozini",
  publisher: "meteozini",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#201d1d" },
    { media: "(prefers-color-scheme: light)", color: "#fdfcfc" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ca-ES" suppressHydrationWarning className={mono.variable}>
      <head>
        <ThemeScript />
      </head>
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
