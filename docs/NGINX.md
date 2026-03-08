# Nginx 設定（本番 apps.andplus.tech）

本番サーバーで `https://apps.andplus.tech/andplus-apps/shopify-ap-llmo/` を Node アプリにプロキシするための設定例。

## 追加する location

schemabridge 用の `location` がある server ブロック内に、以下を**追加**する。  
`PORT` は ap-llmo の Node が listen しているポート番号（例: 3002。ap-schema / schemabridge は 3000 のため別ポートにする）。

```nginx
location /andplus-apps/shopify-ap-llmo/ {
    proxy_pass http://127.0.0.1:PORT;   # 末尾スラッシュなし（パスを維持する）
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
}
```

- **重要**: `proxy_pass` の URL は **末尾にスラッシュを付けない**。付けると Nginx がパスを書き換え、Node に `/` しか届かずルートが一致しなくなる（配布ガイド参照）。

## 反映手順

1. 上記を Nginx の設定ファイルに追加（`/etc/nginx/sites-available/` など）。
2. `sudo nginx -t` で設定を確認。
3. `sudo systemctl reload nginx`（または `sudo nginx -s reload`）で反映。

## ポートについて

- ap-llmo を pm2 等で起動するとき、**schemabridge と別のポート**を指定する（例: schemabridge が 3000 なら ap-llmo は 3002）。
- 起動時の `PORT` と、この `location` の `proxy_pass` のポートを一致させる。
