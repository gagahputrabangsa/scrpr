import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Smart Scraper — LLM-Ready Documentation Crawler",
  description:
    "Recursively crawl developer documentation and API endpoints into a single, structured Markdown file optimized for LLM context windows. Powered by Firecrawl.",
  keywords: [
    "Firecrawl",
    "Smart Scraper",
    "Documentation Crawler",
    "LLM Context",
    "Markdown Converter",
    "Developer Tools",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground flex flex-col">
        {children}
      </body>
    </html>
  );
}

