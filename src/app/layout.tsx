import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import Providers from "@/contexts/Providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Profit Duck - Financial Dashboard",
  description: "Financial operations dashboard powered by Profit Duck",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50`} suppressHydrationWarning>
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              {/* Spacer for mobile top bar */}
              <div className="lg:hidden h-14 shrink-0" />
              <Header />
              <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">{children}</main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
