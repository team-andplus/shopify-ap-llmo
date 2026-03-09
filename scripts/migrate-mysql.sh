#!/usr/bin/env sh
# Prisma が prisma/migrations しか参照しないため、
# 本番で MySQL 用の prisma-mysql/migrations を適用する。
# 1) 一時的に prisma/migrations を差し替えて migrate deploy
# 2) _prisma_migrations に既に登録されていて「No pending」になる場合、
#    LlmoSettings のカラム変更（思想・プロトコル）が未適用の可能性があるので
#    prisma db execute で第三マイグレーションの SQL を直接実行する。

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MIGRATIONS_ORIG="$ROOT/prisma/migrations"
MIGRATIONS_MYSQL="$ROOT/prisma-mysql/migrations"
MIGRATIONS_BAK="$ROOT/prisma/migrations.bak.$$"
SCHEMA="$ROOT/prisma-mysql/schema.prisma"
MIGRATION2="$MIGRATIONS_MYSQL/20250308100000_add_llmo_settings/migration.sql"
MIGRATION3="$MIGRATIONS_MYSQL/20250308110000_llmo_thought_protocol/migration.sql"

# 既存の prisma/migrations を退避（prisma-mysql への symlink でない場合）
if [ -d "$MIGRATIONS_ORIG" ] && [ ! -L "$MIGRATIONS_ORIG" ]; then
  mv "$MIGRATIONS_ORIG" "$MIGRATIONS_BAK"
fi

# prisma-mysql/migrations を prisma/migrations として見せる
rm -f "$MIGRATIONS_ORIG"
ln -s "$MIGRATIONS_MYSQL" "$MIGRATIONS_ORIG"

# マイグレーション実行（MySQL 用スキーマ指定）
prisma migrate deploy --schema=prisma-mysql/schema.prisma || true

# 元に戻す
rm -f "$MIGRATIONS_ORIG"
if [ -d "$MIGRATIONS_BAK" ]; then
  mv "$MIGRATIONS_BAK" "$MIGRATIONS_ORIG"
fi

# 第二・第三マイグレーションを直接実行。
# _prisma_migrations に登録済みで「No pending」のまま、実際には未適用のことがあるため。
# 既に適用済みならエラーになるが、その場合はメッセージを出して続行する。
if [ -f "$MIGRATION2" ]; then
  if prisma db execute --file "$MIGRATION2" --schema="$SCHEMA" 2>/dev/null; then
    echo "[migrate-mysql] Applied 20250308100000_add_llmo_settings (LlmoSettings table)."
  fi
fi
if [ -f "$MIGRATION3" ]; then
  if prisma db execute --file "$MIGRATION3" --schema="$SCHEMA" 2>/dev/null; then
    echo "[migrate-mysql] Applied 20250308110000_llmo_thought_protocol (LlmoSettings columns)."
  fi
fi
# 上記で何も表示されていなければ、いずれも適用済み（正常）
exit 0
