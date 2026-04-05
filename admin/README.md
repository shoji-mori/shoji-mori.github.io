# Shoji Mori Admin

Cloudflare Workers 上で動かす、研究業績サイト用の管理画面の雛形です。

## 目的

- `publications` と `presentations` を D1 に保存する
- 管理画面から編集する
- 既存の `data.js` / JSON を管理画面からアップロードして取り込む
- 公開サイト用の `publications_data.js` / `presentations_data.js` を生成してダウンロードする
- 公開サイト本体は GitHub Pages の静的構成のまま維持する

## 想定構成

- Admin UI: Next.js App Router
- Runtime: Cloudflare Workers with `@opennextjs/cloudflare`
- Auth: Cloudflare Access + GitHub login
- DB: Cloudflare D1

## セットアップ

1. 依存関係を入れる

   ```bash
   cd admin
   npm install
   ```

2. D1 データベースを作る

   ```bash
   npx wrangler d1 create shoji-website-admin
   ```

   返ってきた `database_id` を [`wrangler.jsonc`](/Users/shoji9m/Web/shoji-website-new/admin/wrangler.jsonc) に反映します。

3. マイグレーションを適用する

   ```bash
   npx wrangler d1 migrations apply shoji-website-admin --local
   npx wrangler d1 migrations apply shoji-website-admin --remote
   ```

4. Cloudflare Access を設定する

- 管理画面用の Access application を作る
- GitHub IdP を有効にする
- `Application Audience (AUD)` を控える
- `wrangler.jsonc` の `CLOUDFLARE_ACCESS_TEAM_DOMAIN` と `CLOUDFLARE_ACCESS_AUD` を埋める
- 必要なら `ADMIN_ALLOWED_EMAILS` を自分のメールアドレスに合わせる

5. 既存の公開用 `data.js` から seed JSON を作る

   ```bash
   npm run seed:json
   npm run seed:sql
   ```

   生成物は `tmp/` に出ます。`tmp/seed.sql` を D1 に流し込めます。

   ```bash
   npx wrangler d1 execute shoji-website-admin --remote --file=tmp/seed.sql
   ```

   `--remote` 実行では `BEGIN TRANSACTION` / `COMMIT` を含む SQL は使わない前提です。

6. ローカル開発

   ```bash
   npm run dev
   ```

7. Cloudflare runtime での確認

   ```bash
   npm run preview
   ```

## Access を有効化した後の deploy

Cloudflare Access で `workers.dev` を保護した後は、deploy 時に CLI から保護 URL へ接続するため、
Access Service Token が必要です。deploy 前に以下を shell に設定してください。

```bash
export CLOUDFLARE_ACCESS_CLIENT_ID="..."
export CLOUDFLARE_ACCESS_CLIENT_SECRET="..."
```

その後に通常どおり deploy します。

```bash
npm run deploy
```

## 補足

- `data.js` は正本ではなく生成物です
- `/export` では `publications_data.js` / `presentations_data.js` の upload import もできます
- D1 の `sort_order` を export 順序の基準にします
- `authorsEn` / `authorsJa` は HTML 文字列を保持できる前提です
- 初期実装では PDF や動画本体の upload は扱いません
