# sql-jot

> [English](README.md) | 日本語

EmmetライクなSQL短縮記法。Monaco エディタでの利用を想定していますが、コア
は純粋な TypeScript なのでエディタ非依存で動きます。

```
tbl@a>name,sum(price)@x#name:x<5000$-x
↓
SELECT name, sum(price) AS x
FROM tbl a
GROUP BY name
HAVING x < 5000
ORDER BY x DESC
```

## 動機

SQLクライアントは機能盛りで重くなりがち。sql-jot は逆方向で、
ウィザードより記号で叩きたい打鍵派の少数向けに作っています。

SQL の代替言語**ではありません**。標準SQLにコンパイルされるので、
任意のDB・任意のツールで実行できます。

## 使い方

```bash
npm install sql-jot
```

```ts
import { expand } from "sql-jot";

expand("users@u>u.name?u.id=1");
// → "SELECT u.name FROM users u WHERE u.id = 1"

expand("+users<name=\"alice\",age=30");
// → "INSERT INTO users (name, age) VALUES ('alice', 30)"

expand("=users<count+=1?id=5");
// → "UPDATE users SET count = count + 1 WHERE id = 5"
```

## 演算子早見表

| 記号 | 役割 | 例 |
|---|---|---|
| `>` | SELECT列 | `users>name,email` |
| `?` | WHERE | `?id=1` |
| `+` | JOIN（または INSERT 動詞） | `+orders[u.id=o.user_id]` |
| `[ ]` | ON ／ IN | `?id[1,2,3]`, `?id[(subq)]` |
| `( )` | サブクエリ ／ 列リスト | `+users<(other>name?active=1)` |
| `{ }` | CTE ／ 行ブロック | `{src>id}@s` |
| `#` | GROUP BY | `#user_id` |
| `:` | HAVING | `:count>5` |
| `$` | ORDER BY | `$-created_at` |
| `~` | LIMIT/PAGE | `~20p3` |
| `%` | LIKE | `?name%"john"` |
| `@` | エイリアス | `users@u` |
| `+` `=` `-`（文頭） | INSERT / UPDATE / DELETE 動詞 | `+users<...`, `=users<...?...`, `-users?...` |

全構文の正本は [SYNTAX.ja.md](SYNTAX.ja.md)。

## スキーマ連携

sql-jot はスキーマを所有しません。ホストアプリが小さな Resolver を
提供すると、sql-jot がそれを呼んで FK 自動解決・多段 JOIN 推論・暗黙の
列修飾・検証・補完を行います。

```ts
import { expand, staticResolver } from "sql-jot";

const schema = staticResolver({
  tables: [
    { name: "users", columns: ["id", "name"] },
    { name: "orders", columns: ["id", "user_id", "total"] },
  ],
  foreignKeys: [
    {
      fromTable: "orders",
      fromColumns: ["user_id"],
      toTable: "users",
      toColumns: ["id"],
    },
  ],
});

expand("users@u+orders@o", { schema });
// → "SELECT * FROM users u INNER JOIN orders o ON u.id = o.user_id"
```

実アプリでは `SchemaResolver` を自前のカタログに合わせて実装してください
（`src/types.ts` 参照）。

## 公開API

```ts
import {
  expand,                 // 短縮記法 → SQL文字列
  parse, compile,         // 個別実行
  validate,               // スキーマ突合せの警告列
  getCandidates,          // カーソル位置の候補
  longestCommonPrefix,    // Tab前置一致展開用ヘルパ
  staticResolver,         // 静的スキーマから SchemaResolver を構築
} from "sql-jot";
```

補完APIは **UX非依存**：候補を返すだけで、ポップアップ／インラインゴース
ト／Tabのみ／Ctrl+Space などの提示方法はホスト側が決めます。Emmet 流儀は
「ポップアップで邪魔しない」なので、同梱の example も Tab 前置一致展開＋
インライン検証（赤波線）のみで、ドロップダウンは出しません。

## サンプル

[`example/`](example/) に Vite + Monaco デモがあります:

```bash
cd example
npm install
npm run dev
# → http://localhost:5173
```

二段組みエディタで、ライブSQLプレビュー、構文ハイライト、サンプルの
クイックロード、検証マーカー、Tab 展開が体験できます。

## 状況

v0.0.1。SELECT/INSERT/UPDATE/DELETE、CTE、JOIN（INNER/LEFT/RIGHT/FULL/
CROSS）、スキーマ駆動の JOIN 推論、3形態の IN、qualified star をカバー。
未対応項目は [SYNTAX.ja.md §11](SYNTAX.ja.md#11-v0-の未対応既知の制約) を参照。

## 開発

```bash
npm install        # prepare フックで grammar も自動ビルドされます
npm test           # vitest を実行
```

## ライセンス

[MIT](LICENSE) © msd.shsk
