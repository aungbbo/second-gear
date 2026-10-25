import type { Metadata } from "next";
import { Fraunces, Plus_Jakarta_Sans, Public_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const publicSans = Public_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Italic accent for emphasis phrases in headlines — e.g. "your full budget."
const fraunces = Fraunces({
  variable: "--font-accent",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  style: ["italic"],
});

export const metadata: Metadata = {
  title: "Second Gear — Car shopping for people rebuilding credit",
  description:
    "An agent on the buyer's side. Second Gear reads your credit, your cash flow, and live listings, then shows the true cost of every loan before you sign.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${publicSans.variable} ${fraunces.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
