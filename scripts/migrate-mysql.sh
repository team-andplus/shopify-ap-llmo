#!/usr/bin/env sh
# Prisma が prisma/migrations しか参照しないため、
# 本番で MySQL 用の prisma-mysql/migrations を適用するために
# 一時的に prisma/migrations を差し替えて migrate deploy する。

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MIGRATIONS_ORIG="$ROOT/prisma/migrations"
MIGRATIONS_MYSQL="$ROOT/prisma-mysql/migrations"
MIGRATIONS_BAK="$ROOT/prisma/migrations.bak.$$"

# 既存の prisma/migrations を退避（prisma-mysql への symlink でない場合）
if [ -d "$MIGRATIONS_ORIG" ] && [ ! -L "$MIGRATIONS_ORIG" ]; then
  mv "$MIGRATIONS_ORIG" "$MIGRATIONS_BAK"
fi

# prisma-mysql/migrations を prisma/migrations として見せる
rm -f "$MIGRATIONS_ORIG"
ln -s "$MIGRATIONS_MYSQL" "$MIGRATIONS_ORIG"

# マイグレーション実行（MySQL 用スキーマ指定）
if prisma migrate deploy --schema=prisma-mysql/schema.prisma; then
  STATUS=0
else
  STATUS=$?
fi

# 元に戻す
rm -f "$MIGRATIONS_ORIG"
if [ -d "$MIGRATIONS_BAK" ]; then
  mv "$MIGRATIONS_BAK" "$MIGRATIONS_ORIG"
fi

exit $STATUS
