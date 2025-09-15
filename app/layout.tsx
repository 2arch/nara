import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nara: Explore Neural Worlds",
  description: "typed canvas",
  icons: {
    icon: '/apple-icon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
