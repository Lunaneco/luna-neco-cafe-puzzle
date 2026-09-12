# 全国ランキング

フロントエンドは既存のGitHub Pagesで配信し、Cloudflare WorkersのAPIからD1の記録を読み書きします。ブラウザにCloudflareの管理用認証情報は渡しません。

## プレイヤーに公開する内容

- ニックネーム（NFKC正規化後1〜10文字）、スコア、順位。
- 登録ボタンを押した記録を公開。上位100件と、登録直後の自分の順位を表示。
- スコア降順。同点は登録時刻の早い順、さらに同時なら記録ID順。
- 以前のローカル記録は保持されるが全国ランキングには送らない。

## API

| メソッド | パス | 動作 |
| --- | --- | --- |
| GET | `/api/leaderboard` | 上位100件 |
| POST | `/api/rounds` | 署名付きプレイトークンと乱数シードを発行 |
| POST | `/api/scores` | 名前、スコア、操作履歴、経過時間、トークンを検証して登録。自分の順位も返す |

サーバーが操作履歴を再生して得点・時間延長・2倍効果・特殊タイル・補充を検証します。トークンの署名、発行時刻、24時間以内の登録、実時間との整合性も確認します。1プレイの検証上限は1時間・10,000タップ、本文は200KBです。同一トークンの再送は一意制約で重複登録を防ぎます。APIはIPごとに書き込み毎分30件・閲覧毎分120件の制限を設けます。Cloudflareの地域別・結果整合の制限であり厳密な課金上限ではありません。ログインを要求しないゲームのためIPを使用しますが、学校やモバイル回線など共有IPでは複数人で制限を共有します。

これは改変スコアや不正な盤面を拒否する検証であり、自動プレイ・最適解探索・ニックネームのなりすましを完全には防ぎません。アカウント認証や賞金付き競技の本人確認機能は含みません。IPはレート制限に使用し、アプリのD1には保存しません。操作履歴とトークンもD1には保存せず、記録ID・名前・点数・登録時刻を保存します。

## ローカル検証

Node.js 22の最新版以降を使用します。2つのターミナルで次を実行します。

```sh
npm run ranking:dev
```

```sh
RANKING_API=http://127.0.0.1:8787 npm start
```

`http://127.0.0.1:4173` のゲームからローカルSQLiteへ登録できます。テスト記録はGit管理対象外の `.wrangler/local-ranking.sqlite` に保存され、本番には送りません。API再起動でローカルの署名鍵を変えるため、再起動前に開始したプレイは登録できません。

`npm test` はメモリ上のSQLiteを使って本番と同じSQL・APIを検証します。ブラウザ処理との盤面・得点一致、署名改変・期限切れ・不正得点の拒否、同時送信、同点、圏外順位、CORS、レート制限、再送も確認します。

## Cloudflareへの公開

公式Wrangler CLIを使用します（今回の検証は4.131.1）。Workers / D1の無料枠を使用し、有料プランへの変更は行いません。無料枠の上限に達した場合はランキング通信が失敗し、ゲームは練習モードで動作します。

1. `wrangler login --scopes account:read user:read workers_scripts:write d1:write --use-keyring` で必要な機能に範囲を絞って認証。管理用APIキーをゲームやGitHubへ保存しない。
2. `wrangler d1 create luna-neco-ranking` でD1を作り、返されたIDを `server/wrangler.jsonc` に設定。
3. `wrangler d1 migrations apply DB --remote --config server/wrangler.jsonc` でスキーマを作成。
4. `wrangler deploy --dry-run --config server/wrangler.jsonc` で設定とビルドを検証してから、`npm run ranking:deploy` で公開。未設定のD1 ID、広すぎる通信元、制限やログ保護の欠落は公開前チェックで停止します。
5. 暗号学的乱数32バイトを16進数64文字にした鍵を `wrangler secret put ROUND_SECRET --config server/wrangler.jsonc` の標準入力で設定。ソース・履歴・ログに鍵を含めない。
6. 返されたWorkerのURLを `src/ranking-config.js` に設定し、フロントエンドをGitHubへpush。

既存の公開先を更新するときはD1と署名鍵を再利用します。`ALLOWED_ORIGINS` はゲームのオリジン `https://lunaneco.github.io` に限定します。鍵を交換すると交換前に開始した未登録プレイは検証できなくなるため、通常の更新では変更しません。

参考: [D1の導入](https://developers.cloudflare.com/d1/get-started/)、[Workersの無料枠](https://developers.cloudflare.com/workers/platform/limits/)、[D1の制限](https://developers.cloudflare.com/d1/platform/limits/)、[レート制限](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。


## 安全設定（本番適用済み）

- 本番の通信はHTTPS。書き込みにはゲームのOriginを必須とし、CORSのプリフライトもメソッドとヘッダーを限定。CORSは認証ではないため、署名付きプレイ検証とアクセス制限を併用。
- D1の接続、64文字の署名鍵、閲覧・書き込みの制限が欠けていれば503で停止。制限障害時にも制限なしで処理を続けない。
- ラウンド開始の本文は1KB、スコア本文は200KBまでをストリーム読み取り中にも検査。公開APIは3つだけで、データの更新・削除用の公開管理APIは持たない。
- 署名鍵はWorker Secretsで管理。SQLはバインド変数を使い、名前は画面でテキストとして描画。
- `preview_urls: false` を明示し、過去バージョンや検証用APIの別URL公開を無効化。[Cloudflare公式仕様](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- エラーログは固定のイベント名だけを出力。リクエスト単位の詳細ログとトレースを無効にし、クエリ文字列をマスクする設定。[ログ設定](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- APIクライアントはCookieや認証情報を付けず、リダイレクト先への記録送信も拒否。
- 有料プランへの変更、支払情報の追加、グローバルAPIキーの作成は行わない。

2026-09-12にCloudflareへ適用しました。APIは `https://luna-neco-ranking.luna-neco-cafe-puzzle.workers.dev`、ゲームは既存のGitHub Pagesで配信します。D1は専用データベースを使用し、署名鍵はWorker Secretsだけに保存しています。

46件の自動テストと、実APIでのプリフライト、記録保存、別リクエストからの取得、再送時の重複防止、改変スコア・無関係なOriginの拒否を確認しました。検証用記録は確認後に取り除き、過去の端末内記録は自動で送信しません。
