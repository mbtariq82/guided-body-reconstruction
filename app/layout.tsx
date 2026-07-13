import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Guided Body Reconstruction",
  description: "A smartphone capture and self-hosted SMPL-X human digitisation workbench.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
