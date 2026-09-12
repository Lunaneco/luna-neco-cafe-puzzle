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

サーバーが操作履歴を再生して得点・時間延長・2倍効果・特殊タイル・補充を検証します。トークンの署名、発行時刻、24時間以内の登録、実時間との整合性も確認します。1プレイの検証上限は1時間・10,000タップ、本文は200KBです。同一トークンの再送は一意制約で重複登録を防ぎます。API書き込みはIPごとに毎分30件まで（Cloudflareの地域別レート制限）です。

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

1. `wrangler login` でCloudflareに認証。
2. `wrangler d1 create luna-neco-ranking` でD1を作り、返されたIDを `server/wrangler.jsonc` に設定。
3. `wrangler d1 migrations apply DB --remote --config server/wrangler.jsonc` でスキーマを作成。
4. `wrangler deploy --dry-run --config server/wrangler.jsonc` で設定とビルドを検証してから、`wrangler deploy --config server/wrangler.jsonc` で公開。
5. 暗号学的乱数で生成した32バイト以上の鍵を `wrangler secret put ROUND_SECRET --config server/wrangler.jsonc` の標準入力で設定。ソース・履歴・ログに鍵を含めない。
6. 返されたWorkerのURLを `src/ranking-config.js` に設定し、フロントエンドをGitHubへpush。

既存の公開先を更新するときはD1と署名鍵を再利用します。`ALLOWED_ORIGINS` はゲームのオリジン `https://lunaneco.github.io` に限定します。鍵を交換すると交換前に開始した未登録プレイは検証できなくなるため、通常の更新では変更しません。

参考: [D1の導入](https://developers.cloudflare.com/d1/get-started/)、[Workersの無料枠](https://developers.cloudflare.com/workers/platform/limits/)、[D1の制限](https://developers.cloudflare.com/d1/platform/limits/)、[レート制限](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。
