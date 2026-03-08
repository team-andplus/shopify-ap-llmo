#!/usr/bin/env bash
# サーバー用ビルドに期待する変更が含まれているか確認するスクリプト
# 使い方: ./scripts/verify-build.sh  または  bash scripts/verify-build.sh

set -e
BUILD_FILE="${1:-build/server/index.js}"

echo "=== ビルド確認: $BUILD_FILE ==="
echo ""

if [[ ! -f "$BUILD_FILE" ]]; then
  echo "❌ ビルドファイルが見つかりません。先に npm run build を実行してください。"
  exit 1
fi

FAIL=0

# 1. basename が本番用か
if grep -q 'basename = "/andplus-apps/shopify-ap-llmo/"' "$BUILD_FILE"; then
  echo "✅ basename が本番パスになっている"
else
  echo "⚠️  basename を確認: 本番デプロイ時は npm run build:prod-url でビルド推奨"
  grep -o 'basename = "[^"]*"' "$BUILD_FILE" || true
fi

# 2. アプリホーム用フォールバック（useOutlet / isAppHome / AppIndex）が含まれるか
if grep -q 'useOutlet()' "$BUILD_FILE" && grep -q 'isAppHome' "$BUILD_FILE" && grep -q 'AppIndex' "$BUILD_FILE"; then
  echo "✅ アプリホーム用フォールバック（useOutlet, isAppHome, AppIndex）が含まれている"
else
  echo "❌ アプリホーム用フォールバックがビルドに含まれていません（古いビルドの可能性）"
  FAIL=1
fi

# 3. app loader に storeUrl が含まれるか
if grep -q 'storeUrl' "$BUILD_FILE"; then
  echo "✅ storeUrl がビルドに含まれている"
else
  echo "❌ storeUrl がビルドに含まれていません"
  FAIL=1
fi

# 4. routes/app._index が定義されているか
if grep -q '"routes/app._index"' "$BUILD_FILE" && grep -q 'index: true' "$BUILD_FILE"; then
  echo "✅ routes/app._index（index: true）が定義されている"
else
  echo "❌ app._index ルートが正しく含まれていません"
  FAIL=1
fi

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "=== ビルド内容は期待どおりです。本番で変化しない場合は以下を確認してください。 ==="
  echo "  - 本番サーバーでこのビルドを再デプロイ・再起動したか"
  echo "  - ブラウザのキャッシュ無効化（スーパーリロード Ctrl+Shift+R / Cmd+Shift+R）"
  echo "  - CDN/プロキシのキャッシュ"
  exit 0
else
  echo "=== 上記の不足があるため、ソースを反映してから再度 npm run build を実行してください。 ==="
  exit 1
fi
