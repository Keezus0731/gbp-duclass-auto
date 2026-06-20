# gbp-duclass-auto

Googleビジネスプロフィール「デュクラス大阪」へ、**毎週月・木 10:00（JST）**に
最新情報投稿を自動投稿する仕組み（GitHub Actions / クラウド実行・PCオフでも稼働）。

## 仕組み
- `bank.json` … MEO最適化済みの投稿ネタ集（被り防止のため使い切るまで重複なし）
- `history.json` … 投稿済みネタの記録（毎回ここを見て未使用を選ぶ → 投稿後に追記）
- `post.js` … 未使用ネタを1本選び、GBP API（v4 localPosts）で投稿
- `.github/workflows/post.yml` … 月木 01:00 UTC（=10:00 JST）に自動実行
- `images/` … テーマ別の写真（画像配信を有効化すると投稿に自動添付）

CTAは投稿の `type` で自動切替：
- `top`（会場全般）→ 五星ウェディングTOP
- `fair`（フェア紹介）→ フェアページ

## 認証（GitHub Actions Secrets に保管・コードには置かない）
- `GBP_CLIENT_ID`
- `GBP_CLIENT_SECRET`
- `GBP_REFRESH_TOKEN`

## 運用メモ
- ネタの残りが少なくなったら `bank.json` に追記（または依頼）して補充。
- 手動でテスト投稿したいときは Actions タブ →「GBP デュクラス大阪 自動投稿」→ Run workflow。
- 画像を使う場合は、リポジトリ Variables に `IMAGE_BASE_URL` を設定し、`images/<theme>/` に写真を配置。
