# 共通ルール（_rules）のセットアップ

開発ルールは **andplus-dev-rules** をサブモジュールとして参照する。

## 初回（リポジトリを clone した直後）

```bash
cd shopify-ap-llmo
git submodule update --init --recursive
ln -s ../_rules/.cursor/rules .cursor/rules
```

`.cursor` が無い場合は先に作成する:

```bash
mkdir -p .cursor
ln -s ../_rules/.cursor/rules .cursor/rules
```

## 既にこのリポジトリにサブモジュールが未追加の場合（初回セットアップ）

```bash
cd shopify-ap-llmo
git submodule add https://github.com/mmochi/andplus-dev-rules.git _rules
ln -s ../_rules/.cursor/rules .cursor/rules
```

## 共通ルールの更新を取り込むとき

```bash
git submodule update --remote _rules
```

**_rules 内では編集・commit しない。** 参照の更新だけ行う。共通ルールの変更は andplus-dev-rules リポジトリで管理者が行う。
