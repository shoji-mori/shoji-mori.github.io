import type { ReactNode } from "react";
import Link from "next/link";

import { getOptionalAdminUser } from "@/lib/auth";

import "./globals.css";

export const dynamic = "force-dynamic";

type RootLayoutProps = {
  children: ReactNode;
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const user = await getOptionalAdminUser();

  return (
    <html lang="ja">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">
              <strong>Shoji Mori Admin</strong>
              <span>Research data management</span>
            </div>

            <nav>
              <Link href="/dashboard">
                Dashboard
              </Link>
              <Link href="/publications">
                Publications
              </Link>
              <Link href="/presentations">
                Presentations
              </Link>
              <Link href="/export">
                Export
              </Link>
            </nav>

            {user ? <div className="user-chip">{user.email}</div> : null}
          </header>

          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}
