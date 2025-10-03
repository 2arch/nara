import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nara: A Space for Big Ideas",
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
