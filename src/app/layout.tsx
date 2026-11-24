import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

// Two faces of one family, drawn to keep look-alike characters apart (0 and O, 1 and l and I):
// that is what reviewing a suspicious value needs. The interface face for labels and counts.
const interfaceFace = Atkinson_Hyperlegible_Next({
  variable: "--font-interface",
  subsets: ["latin"],
});

// The mono face only for what comes from the file: cell values, column names, the file name.
const fileFace = Atkinson_Hyperlegible_Mono({
  variable: "--font-file",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Data cleanup assistant",
  description:
    "Upload a CSV, review every suggested edit, and download the cleaned file with a record of each change.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${interfaceFace.variable} ${fileFace.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
