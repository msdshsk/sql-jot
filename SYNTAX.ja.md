# sql-jot 構文リファレンス

> [English](SYNTAX.md) | 日本語

最後にまとめた日: 2026-05-01

このドキュメントは、現状実装されている sql-jot の文法と意味論をすべて網羅する。実装と乖離したら**実装が正**、ここを直す。

---

## 1. 設計思想

- **動詞プレフィックス + 演算子記号** で SELECT/INSERT/UPDATE/DELETE を最短表現
- 各 SQL 句に**ユニークな記号**を割り当ててトップレベルで曖昧性ゼロ
- リテラルはダブルクォート (`"x"`) で、識別子は裸で書く
- スキーマ依存の補完（FK解決等）は**ホストが提供する Resolver** に委譲

---

## 2. 動詞プレフィックス

| プレフィックス | 操作 | 例 |
|---|---|---|
| (なし) | SELECT | `users>name?id=1` |
| `+` | INSERT | `+users<name="alice"` |
| `=` | UPDATE | `=users<name="bob"?id=1` |
| `-` | DELETE | `-users?id=1` |

**位置依存**:
- 文頭の `+` `-` `=` は動詞
- 文中の `+` は JOIN
- 文中の `-` は ORDER BY 内の DESC マーカー
- 文中の `=` は比較演算子

文脈で完全に分離されるため、PEGで一意にパースできる。

---

## 3. 演算子マップ（SELECT文中）

| 記号 | 用途 | 例 |
|---|---|---|
| `@` | エイリアス | `users@u`, `sum(x)@total` |
| `>` | SELECT列リスト | `users>name,email` |
| `?` | WHERE | `users?id=1` |
| `+` | JOIN | `users+orders` |
| `[ ]` | ON条件 ／ IN（リスト/参照/サブクエリ） | `+t[a.id=b.id]`, `?id[1,2,3]`, `?id[cte]`, `?id[(subq)]` |
| `( )` | インラインサブクエリ ／ INSERT列リスト ／ 式グルーピング | `+t<(s>x)`, `+t(c1,c2)<(...)` |
| `{ }` | CTE（文頭）／ INSERT行ブロック（`<`の後） | `{src>x}@s`, `+t<{a=1},{a=2}` |
| `#` | GROUP BY | `users#dept` |
| `:` | HAVING | `:count>5` |
| `$` | ORDER BY | `$-created_at,+id` |
| `~` | LIMIT/PAGE | `~20p3` |
| `,` | リスト区切り兼AND | |
| `\|` | OR | `?a=1\|b=2` |
| `%` | LIKE | `?name%"john"` |
| `"..."` | 文字列リテラル | |
| `=` `<` `>` `<=` `>=` `<>` `!=` | 比較 | |

---

## 4. SELECT 構文

### 4.1 基本構造

```
[CTEブロック] テーブル参照 [節...]
```

各節は**任意の順序**で書ける。コンパイラが SQL の正規順に並べ直す。

### 4.2 テーブル参照とエイリアス

```
users               # 別名なし
users@u             # 別名 u
```

### 4.3 SELECT列リスト `>`

```
users>name,email                # 2列
users>*                         # 全列
users@u>u.*                     # 別名uで全列指定（qualified star）
users>name@n,email@e            # 列にエイリアス
users>sum(price)@total          # 集約関数
users@u>u.name,u.email          # 修飾列
```

複数テーブルJOIN下では `t.*` と通常列を混在できる: `a@a+b@b[a.id=b.aid]>a.*,b.x`

**`t.*` の典型用途**:
JOINした副テーブルをWHERE句のフィルタとしてだけ使い、SELECT結果には主テーブルの列だけ出したい時:

```
wholesalers@w>w.*?f.child_code["a","b","c"]+<formats@f[f.id=w.format_id]
→ SELECT w.* FROM wholesalers w
   LEFT JOIN formats f ON f.id = w.format_id
   WHERE f.child_code IN ('a', 'b', 'c')
```

省略時は暗黙的に `*`。

### 4.4 WHERE `?`

```
users?id=1                      # 等価
users?age>=18                   # 比較
users?id<>0                     # 不等
users?name%"john"               # LIKE
users?id[1,2,3]                 # IN
users?a=1,b=2                   # AND（カンマ）
users?a=1|b=2                   # OR（パイプ）
users?a=1,b=2|c=3               # AND/OR混在 → (a=1 AND b=2) OR c=3
users?(a=1|b=2),c=3             # 括弧でグループ化
```

### 4.5 JOIN `+`

| 記法 | JOIN種別 |
|---|---|
| `+tbl` | INNER（既定） |
| `+<tbl` | LEFT |
| `+>tbl` | RIGHT |
| `+*tbl` | FULL |
| `+~tbl` | CROSS |

ON は `[ ]` で続けて指定:

```
users@u+orders@o[u.id=o.user_id]
```

ON を省略するとスキーマ Resolver から FK 自動解決（後述）。

### 4.6 GROUP BY `#`

```
orders#user_id                  # 単一列
orders#user_id,status           # 複数列
```

### 4.7 HAVING `:`

```
orders#user_id>sum(total)@s:s>1000
```

WHERE と同じ式構文。

### 4.8 ORDER BY `$`

```
users$created_at                # ASC（既定）
users$-created_at               # DESC
users$+name                     # ASC（明示）
users$-priority,+name           # 複数キー
```

### 4.9 LIMIT/PAGE `~`

```
users~20                        # LIMIT 20
users~20p3                      # LIMIT 20 OFFSET 40（page=3）
```

`page=1` が既定なので OFFSET=0 → `LIMIT n` のみ出力。

DB方言別変換は `CompileOptions.paginate` フックで差し替え可能。

---

## 5. CUD 構文

### 5.1 INSERT — `+`

#### 5.1.1 単一行

```
+users<name="alice",age=30
→ INSERT INTO users (name, age) VALUES ('alice', 30)
```

#### 5.1.2 複数行（`{}` 行ブロック）

```
+users<{name="alice",age=30},{name="bob",age=25}
→ INSERT INTO users (name, age) VALUES ('alice', 30), ('bob', 25)
```

各行ブロックは**同じ列を同じ順で**宣言する必要あり。違反するとコンパイル時エラー。

#### 5.1.3 INSERT...SELECT

```
+users<(other>name,age?active=1)
→ INSERT INTO users SELECT name, age FROM other WHERE active = 1

+users(name,age)<(other>name,age?active=1)
→ INSERT INTO users (name, age) SELECT name, age FROM other WHERE active = 1
```

列リストは `+table` 直後の `( )` で明示。省略時は INSERT 側に列リストを出さない。

### 5.2 UPDATE — `=`

```
=users<active=0?id=5
→ UPDATE users SET active = 0 WHERE id = 5

=users<a=1,b="x"?id=5
→ UPDATE users SET a = 1, b = 'x' WHERE id = 5

=users@u<active=0?u.id=5
→ UPDATE users u SET active = 0 WHERE u.id = 5
```

#### 5.2.1 複合代入（SET右辺のみ）

| 演算子 | 展開 |
|---|---|
| `+=` | `col = col + v` |
| `-=` | `col = col - v` |
| `*=` | `col = col * v` |
| `/=` | `col = col / v` |

```
=users<count+=1?id=5
→ UPDATE users SET count = count + 1 WHERE id = 5
```

複合代入は SET の右辺**だけ**で有効。WHERE 等の式では算術未対応。

### 5.3 DELETE — `-`

```
-users?id=5
→ DELETE FROM users WHERE id = 5

-users
→ DELETE FROM users      # WHERE省略は構文上は許容
```

> 全行削除を文法レベルでブロックしない設計判断。安全装置はホスト側で。

---

## 6. CTE — `{ }` プレフィックス

```
{src>name?active=1}@active_users + users@u[active_users.id=u.id]
→ WITH active_users AS (SELECT name FROM src WHERE active = 1)
   SELECT * FROM active_users
   INNER JOIN users u ON active_users.id = u.id
```

**ルール**:
- `{ ... }@name` で1つのCTE定義
- 複数CTE は `{...}@a,{...}@b` でカンマ区切り
- CTE ブロックと主クエリの間にも**任意で `,` を置ける**（SQLの `WITH a AS (...), b AS (...) SELECT...` 感覚）:

```
{formats>id?id[1,2,3,4]}@f,wholesalers>*?format_id[f]
→ WITH f AS (SELECT id FROM formats WHERE id IN (1,2,3,4))
   SELECT * FROM wholesalers WHERE format_id IN (SELECT * FROM f)
```

- メインクエリで FROM が省略され、かつ CTE が**1つだけ**なら、その CTE alias が暗黙の FROM になる
- CTE は CUD 動詞の前にも書ける: `{...}@s+target<(s>...)`

---

## 7. 式（Expression）

### 7.1 リテラル

```
1            数値
1.5          浮動小数
"hello"      文字列（"内のエスケープは \" \\ ）
```

### 7.2 識別子

```
name         単純識別子
u.name       qualified（ドット2段）
```

### 7.3 関数呼び出し

```
sum(price)
count(*)              # ※ * を引数に直接書く構文は v0 で未サポート
coalesce(a,b,c)
lower(name)
```

**注**: `count(*)` のような `*` 引数は現状の文法で未サポート。`count(id)` で代用するか、将来拡張。

### 7.4 比較

```
=  <>  !=  <  <=  >  >=
```

### 7.5 LIKE — `%"パターン"`

```
?name%"john"            → name LIKE '%john%'   # 自動両側ワイルドカード
?name%"j%"              → name LIKE 'j%'
?name%"%n"              → name LIKE '%n'
?name%"%john%"          → name LIKE '%john%'   # 既に%があれば素通し
```

ルール: クォート内に `%` が**含まれていなければ**両側に `%` を補う。**含まれていればそのまま**。

### 7.6 IN — `列[...]`

`[ ]` の中身は3形態のいずれか:

| 形態 | 構文 | 展開 |
|---|---|---|
| **リテラルリスト** | `?col[1,2,3]` | `col IN (1, 2, 3)` |
| **テーブル/CTE参照** | `?col[name]` | `col IN (SELECT * FROM name)` |
| **サブクエリ** | `?col[(subq)]` | `col IN (subq展開後のSQL)` |

```
?status[1,2,3]                  → status IN (1, 2, 3)
?status["a","b","c"]            → status IN ('a', 'b', 'c')
?id[selection]                  → id IN (SELECT * FROM selection)
?id[(audits>user_id?action="login")]
                                → id IN (SELECT user_id FROM audits WHERE action = 'login')
```

**ルール**:
- リテラルリストの要素は数値か文字列のみ。リテラルと識別子の混在は不可（パース失敗）
- テーブル/CTE参照は単一の裸識別子のみ。`[t.col]` は不可（`[(t>col)]` を使う）
- サブクエリは `( ... )` で範囲明示。中に CTE もネスト可能

---

## 8. スキーマ連携

`expand(src, { schema })` の `schema` には `SchemaResolver` を渡す。

### 8.1 Resolver インターフェース

```ts
interface JoinPathStep {
  table: string;
  fromCols: string[];
  toCols: string[];
}

interface SchemaResolver {
  // (from→to) のJOIN経路。直接FKなら length=1、多段なら>1
  resolveJoin(from: string, to: string): JoinPathStep[] | null;

  // テーブルの列名一覧
  listColumns(table: string): string[] | null;

  // 全テーブル列挙（候補補完で使用、optional）
  listTables?(): string[] | null;
}
```

ホスト側で実装するか、`staticResolver(schema)` で静的構成から生成。

### 8.2 FK 自動解決

ON句省略時、Resolver からFKを引いて補う:

```
users@u+orders@o
→ ... INNER JOIN orders o ON u.id = o.user_id
```

### 8.3 多段 JOIN 推論

直接 FK が無いとき、`resolveJoin` がパスを返せば中間 JOIN を自動挿入:

```
users+items
→ ... INNER JOIN orders ON users.id = orders.user_id
      INNER JOIN items ON orders.id = items.order_id
```

- 中間 JOIN は常に **INNER**
- ユーザ指定の JOIN 型（`+<` 等）は**最終ステップにのみ**適用
- ユーザ指定のエイリアスは**最終ステップにのみ**付与

### 8.4 暗黙の列 qualify

複数テーブルが scope にある状態で、bare な列が**1つのテーブルにしか存在しない**場合、自動で修飾:

```
users+orders?total>1000
→ ... WHERE orders.total > 1000     # totalはordersのみ
```

両テーブルにある列は**そのまま** (`created_at` 等)。`validate()` で曖昧警告を出す。

### 8.5 検証 — `validate(ast, schema)`

`ValidationIssue[]` を返す。位置情報は v0 では未実装（名前ベース）。

検出する問題:
- 未知のテーブル
- 既知テーブル上の未知の列
- 複数テーブルにまたがる曖昧な bare 列
- 未知のテーブル/エイリアス参照（qualified IDの先頭）

### 8.6 候補列挙 — `getCandidates(input, cursor, schema)`

カーソル位置の文脈に応じて候補を返す。**UXは決めない**（ホスト責務）。

| 直前トークン | 候補種別 |
|---|---|
| 文頭 / `+` / `-` / `(` 直後 | テーブル |
| `>` `?` `:` `#` `$` `,` `<` `\|` `=` `[` 直後 | 列（scope内テーブル） |
| `識別子.` 直後 | その識別子のテーブル/エイリアスの列 |
| `@` 直後 | （候補なし — エイリアス命名中） |

`longestCommonPrefix(candidates)` ヘルパで Tab 前置一致展開を実装可能。

---

## 9. パース時の文脈ルール（実装メモ）

### 9.1 同記号の多義性

| 記号 | 文脈 | 意味 |
|---|---|---|
| `+` | 文頭 | INSERT動詞 |
| `+` | テーブル参照後・節中 | JOIN |
| `+` | OrderItem内 | ASC修飾 |
| `-` | 文頭 | DELETE動詞 |
| `-` | OrderItem内 | DESC修飾 |
| `-` | 数値リテラル先頭 | 負号 |
| `=` | 文頭 | UPDATE動詞 |
| `=` | 式中 | 比較演算子 |
| `=` | SET節中 | 代入 |
| `<` | 動詞後 | VALUES/SET導入 |
| `<` | JoinType | LEFT |
| `<` | 式中 | 比較 |
| `>` | テーブル参照後 | SELECT列リスト |
| `>` | JoinType | RIGHT |
| `>` | 式中 | 比較 |
| `[ ]` | JOIN後 | ON句 |
| `[ ]` | 列の直後 | IN |
| `( )` | テーブル後・<前 | INSERT列リスト |
| `( )` | <の後 | サブクエリ |
| `( )` | 式中 | グルーピング |
| `{ }` | 文頭 | CTE |
| `{ }` | <の後 | INSERT行ブロック |
| `,` | 式中（WHERE/HAVING） | AND |
| `,` | リスト中（SELECT/GROUP/ORDER等） | 区切り |
| `,` | CTE末尾と主クエリの間 | 任意の区切り（無くてもよい） |
| `*` | SELECT列の単独 | 全列 |
| `*` | `<ident>.<*>` | qualified star（そのテーブル全列） |
| `*` | JoinType | FULL JOIN |

### 9.2 リテラル

- 文字列: `"..."`（必須）
- 数値: 整数 or 小数

数値以外のリテラル（`true` `false` `null`）は v0 未対応。

---

## 10. v0 の未対応・既知の制約

| 項目 | 状態 | 備考 |
|---|---|---|
| 式中の算術（`a+b`, `a*2`） | 未対応 | SET 右辺の `+= -= *= /=` のみ可 |
| `count(*)` の `*` 引数 | 未対応 | `count(id)` で代用 |
| `IS NULL` / `IS NOT NULL` | 未対応 | |
| `BETWEEN` | 未対応 | `?x>=a,x<=b` で代用 |
| `true`/`false`/`null` リテラル | 未対応 | |
| UPDATE/DELETE の JOIN | 未対応 | |
| IN以外の場所での相関サブクエリ | 未対応 | IN内は `[(subq)]` で対応済 |
| 複数CTE のテストカバレッジ | 薄い | 文法は対応 |
| validate の位置情報 | 未対応 | 名前のみ返す |
| `BETWEEN`/`IS NULL` 等の独自短縮 | 未設計 | |
| UNION / UNION ALL | 未対応 | |
| WINDOW 関数 | 未対応 | |
| DISTINCT | 未対応 | |

---

## 11. 設計上の決定事項アーカイブ

会話で決まった「なぜそうしたか」のメモ。将来揺り戻されないように残す。

- **`+` を INSERT動詞に**: `-` (DELETE) との視覚的対称性。SQL に文頭 `+` は無いので衝突なし
- **`{}` を行ブロック、`()` を列リスト**: `()` は SQL ネイティブ記法と一致。`{}` は「ブロック」一意の意味に純化
- **SET右辺のみ複合代入**: 式全体への算術導入を避けつつ実用ケース（カウンタ）を救う
- **DELETE WHERE 必須化しない**: 構文の責務を逸脱。安全装置はホスト
- **LIKE はクォート内 `%`**: リテラルとしての一貫性。`c1%n` 系の裸記法は `%` の位置と意味が逆転して直感に反する
- **`~20p3` の `p` 接尾辞**: `/` だと「20分の3」に読まれる懸念があった
- **AND は `,`、OR は `\|`**: AND が圧倒的多数なので短い記号を割り当て
- **スキーマ非所有**: sql-jot は問い合わせ口だけ。データ取得・キャッシュ・型管理はホスト責務
- **補完ポップアップ非実装**: Emmet ユーザにはポップアップが邪魔。Tab前置一致と Ctrl+Space を経路として用意し、UI 判断はホスト

### 11.1 演算子の語呂シート

「なんでこの記号？」と未来の自分が悩んだ時のメモ。記号選定の背景。

| 記号 | 由来 |
|---|---|
| `$` | **$** の字形は **S** が下敷き → **s**ort（ORDER BY） |
| `?` | "what?" → 問い合わせ条件（WHERE） |
| `%` | SQLの `%` ワイルドカードそのまま（LIKE） |
| `#` | hash/タグ → クラスタ化（GROUP BY） |
| `:` | 「〜という性質を持つもの」のラベル（HAVING） |
| `@` | "at" → エイリアスのアドレス |
| `+` / `-` | 加算/減算 → 行追加/削除（INSERT/DELETE） |
| `=` | 代入 → 値の更新（UPDATE） |
| `>` | データを射出する向き（SELECT列） |
| `<` | データを流し込む向き（INSERT/UPDATE のVALUES/SET導入） |
| `~` | 「だいたい N 件」の感じ（LIMIT） |
| `\|` | パイプ → 論理和（OR） |
| `,` | 列挙 → AND と区切り |
| `{}` | グループブロック（CTE / 行ブロック） |
| `[]` | 添え字感 → IN リスト ／ ON マッピング |
| `()` | 通常の式グルーピング ／ サブクエリ ／ INSERT列リスト |

---

## 12. 公開API

```ts
import {
  expand,                  // (src, options?) => SQL string
  parse,                   // (src) => Query AST
  compile,                 // (ast, options?) => SQL string
  validate,                // (ast, schema) => ValidationIssue[]
  getCandidates,           // (input, cursor, schema) => CandidatesResult
  longestCommonPrefix,     // (string[]) => string
  staticResolver,          // (StaticSchema) => SchemaResolver
} from "sql-jot";

import type {
  Query, MainQuery, Expr, Join, TableRef,
  CompileOptions, SchemaResolver, JoinPathStep,
  Candidate, CandidatesResult, ValidationIssue,
  StaticSchema, StaticTable, StaticForeignKey,
} from "sql-jot";
```
