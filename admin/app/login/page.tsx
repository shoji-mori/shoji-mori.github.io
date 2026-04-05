import Link from "next/link";

import { getOptionalAdminUser } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getOptionalAdminUser();

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Login</h1>
          <p>この管理画面は Cloudflare Access によって保護される想定です。</p>
        </div>
      </div>

      <div className="card stack">
        <p className="muted">
          Access が正しく設定されていれば、このページに到達する前に GitHub
          ログインが要求されます。
        </p>

        {user ? (
          <div className="notice">
            現在のユーザー: {user.email}
          </div>
        ) : (
          <div className="empty">
            認証ヘッダーがありません。ローカル開発か、Access 未設定の可能性があります。
          </div>
        )}

        <div className="inline-actions">
          <Link className="button" href="/dashboard">
            Dashboard へ
          </Link>
        </div>
      </div>
    </div>
  );
}
