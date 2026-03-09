# サーバーに Git でデプロイする手順

## 1. サーバーで SSH 鍵を用意する（GitHub 用）

サーバーに SSH ログインして実行する。

```bash
# 鍵がなければ作成（既にある場合はスキップ）
ssh-keygen -t ed25519 -C "apps.andplus.tech" -f ~/.ssh/id_ed25519_github -N ""
```

表示される **公開鍵** をコピーする:

```bash
cat ~/.ssh/id_ed25519_github.pub
# ssh-ed25519 AAAAC3... apps.andplus.tech をコピー
```

---

## 2. GitHub に鍵を登録する

### 方法A: このリポジトリだけ使う（Deploy key）

1. GitHub → **mmochi/shopify-ap-llmo** → **Settings** → **Deploy keys** → **Add deploy key**
2. Title: `apps.andplus.tech` など
3. Key: 上でコピーした `ssh-ed25519 ...` を貼る
4. **Add key**

### 方法B: 自分のアカウントの鍵として使う

1. GitHub → 右上アイコン → **Settings** → **SSH and GPG keys** → **New SSH key**
2. Title: `apps.andplus.tech` など
3. Key: 同じく貼る → **Add SSH key**

---

## 3. サーバーで SSH の config を設定（Deploy key の場合）

Deploy key を使う場合、GitHub 用にこの鍵を指定する。

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
cat >> ~/.ssh/config << 'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

（方法B でアカウントの鍵を登録した場合は、通常は `~/.ssh/id_ed25519` をそのまま使えるので、この config は不要なことが多い。）

---

## 4. 接続テスト

```bash
ssh -T git@github.com
# Hi mmochi/... と出れば OK。Permission denied なら鍵登録を確認。
```

---

## 5. クローン先のディレクトリを用意してクローン

サーバー上のパスは Nginx や既存構成に合わせる（例: `/var/www/apps.andplus.tech/andplus-apps/`）。

```bash
# 親ディレクトリへ（common が既にある想定）
cd /var/www/apps.andplus.tech/andplus-apps

# 既に shopify-ap-llmo が空で存在する場合は削除してから
# sudo rm -rf shopify-ap-llmo   # 必要なら

# SSH でクローン（GitHub のリポジトリ URL）
git clone git@github.com:mmochi/shopify-ap-llmo.git shopify-ap-llmo
cd shopify-ap-llmo
```

HTTPS でクローンの場合（Personal Access Token が必要）:

```bash
git clone https://github.com/mmochi/shopify-ap-llmo.git shopify-ap-llmo
# ユーザー名: mmochi、パスワード: GitHub の Personal Access Token
```

---

## 6. サブモジュールがあれば取得

```bash
cd /var/www/apps.andplus.tech/andplus-apps/shopify-ap-llmo
git submodule update --init --recursive
```

---

## 7. 本番用ビルド・DB・.env

```bash
cd /var/www/apps.andplus.tech/andplus-apps/shopify-ap-llmo

# common と .env を用意（common が同階層にある想定）
# common/shopify-ap-llmo.env が無ければ作成する
ls ../common/shopify-ap-llmo.env   # なければ手動で作成

# 本番ビルド＋DB マイグレーション
set -a && source ../common/shopify-ap-llmo.env && set +a
npm ci --omit=dev
npm run setup:prod
# 重要: basename を埋め込むため本番 URL 指定でビルド（これがないと /andplus-apps/shopify-ap-llmo/ で 404）
npm run build:prod-url

# 起動確認（PORT は Nginx の proxy_pass に合わせる。例: 3001）
export PORT=3001
npm run start
```

Ctrl+C で止めて、pm2 で常時起動する場合:

**必ずアプリのディレクトリで実行する**（serve は `build/client/assets` を相対パスで参照するため、cwd が違うと JS が 404 で真っ白になる）:

```bash
cd /var/www/apps.andplus.tech/andplus-apps/shopify-ap-llmo
PORT=3001 DOTENV_CONFIG_PATH=../common/shopify-ap-llmo.env pm2 start npm --name shopify-ap-llmo -- run start
pm2 save
```

すでに別のディレクトリから起動してしまった場合は、一度削除してから上のように `cd` して起動し直す:

```bash
pm2 delete shopify-ap-llmo
cd /var/www/apps.andplus.tech/andplus-apps/shopify-ap-llmo
PORT=3001 DOTENV_CONFIG_PATH=../common/shopify-ap-llmo.env pm2 start npm --name shopify-ap-llmo -- run start
pm2 save
```

cwd の確認: `pm2 show shopify-ap-llmo` の **exec cwd** が `.../shopify-ap-llmo` になっていること。またサーバー上に `build/client/assets/*.js` が存在することを確認する。

---

## 8. 今後コードを更新するとき

```bash
cd /var/www/apps.andplus.tech/andplus-apps/shopify-ap-llmo
git pull
git submodule update --init --recursive
npm ci --omit=dev   # 依存に変更があれば
# 重要: prisma のスキーマ／マイグレーション変更があった場合は必ず実行（LlmoSettings 等の新テーブルを作成）
set -a && source ../common/shopify-ap-llmo.env && set +a
npm run setup:prod
npm run build
pm2 restart shopify-ap-llmo
```

**Application Error が出る場合**: 新規テーブル（例: LlmoSettings）追加後に `setup:prod` を実行していないと MySQL にテーブルがなくエラーになる。上記の `npm run setup:prod` を実行してから再起動すること。

**補足**: `setup:prod` では MySQL 用マイグレーションを **prisma-mysql/migrations** から適用するため、`prisma migrate deploy` を `prisma-mysql` ディレクトリで実行している。ログに「3 migrations found in prisma-mysql/migrations」や「Applying migration ...」と出れば MySQL に正しく適用されている。

---

## 9. 本番で 404 のときの確認（basename が入っているか）

**手順（サーバーで順に実行）:**

```bash
cd /var/www/apps.andplus.tech/andplus-apps/shopify-ap-llmo

# (1) pull した設定に defaultProdUrl が入っているか
grep -n "defaultProdUrl\|envUrl" react-router.config.ts
# → "defaultProdUrl" と "envUrl" の行が出れば OK。出ない場合は git pull が反映されていない。

# (2) ビルド成果物を消してからビルド（キャッシュを外す）
rm -rf build
npm run build

# (3) ビルド結果の basename を確認
grep -o 'basename = "[^"]*"' build/server/index.js
# → basename = "/andplus-apps/shopify-ap-llmo/" なら OK。basename = "/" のままなら設定が効いていない。

# (4) 直っていれば再起動
pm2 restart shopify-ap-llmo
```

- **(1) で何も出ない** → リポジトリの最新がサーバーに来ていない（ブランチ・リモート・push を確認）。
- **(1) は出るが (3) がまだ "/"** → 同じディレクトリで `npm run build` しているか、別の `.env` が `SHOPIFY_APP_URL` を上書きしていないか確認。必要なら `unset SHOPIFY_APP_URL` してから `npm run build`。

---

## common と .env について

- `DOTENV_CONFIG_PATH=../common/shopify-ap-llmo.env` なので、`/var/www/apps.andplus.tech/andplus-apps/common/shopify-ap-llmo.env` が存在する必要がある。
- `common` フォルダはこのリポジトリには含まれない。schemabridge などで既に `common` があるなら、そこに `shopify-ap-llmo.env` を追加する。
- 中身は `SHOPIFY_APP_URL`、`DATABASE_URL`（本番 MySQL）、`SHOPIFY_API_KEY`、`SHOPIFY_API_SECRET` など（README または .env.example 参照）。
