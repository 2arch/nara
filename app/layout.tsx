import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nara — A space for boundless creation",
  description: "An infinite canvas for thinking, writing, and creating. Let your ideas roam free across boundless space.",
  icons: {
    icon: '/nara.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
        <meta name="theme-color" content="#F0FF6A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
