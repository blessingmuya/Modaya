import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Modaya — edit like your reference",
  description:
    "Drop footage and a reference clip. Modaya measures the reference, plans validated edit operations, and renders a real MP4 server-side with ffmpeg.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
