{{
  function flatAnd(items) {
    return items.length === 1 ? items[0] : { type: "and", items };
  }
  function flatOr(items) {
    return items.length === 1 ? items[0] : { type: "or", items };
  }
}}

Start
  = _ ctes:CTEBlock? _ body:QueryBody _ {
      return { type: "query", ctes: ctes || [], body };
    }

QueryBody
  = InsertQuery
  / UpdateQuery
  / DeleteQuery
  / SelectQuery

SelectQuery
  = main:MainQuery { return { kind: "select", main }; }

InsertQuery
  = "+" _ tbl:TableRef cols:InsertColList? _ "<" _ values:InsertValues
    returning:(_ @ReturningClause)? {
      return {
        kind: "insert",
        table: tbl,
        cols: cols || null,
        values,
        returning: returning || null,
      };
    }

InsertColList
  = "(" _ first:Identifier rest:(_ "," _ @Identifier)* _ ")" {
      return [first, ...rest];
    }

InsertValues
  = "(" _ subq:Start _ ")" { return { kind: "subquery", query: subq }; }
  / RowList

RowList
  = first:BracedRow rest:(_ "," _ @BracedRow)* {
      return { kind: "rows", rows: [first, ...rest] };
    }
  / single:AssignList {
      return { kind: "rows", rows: [single] };
    }

BracedRow
  = "{" _ pairs:AssignList _ "}" { return pairs; }

AssignList
  = first:SimpleAssign rest:(_ "," _ @SimpleAssign)* { return [first, ...rest]; }

SimpleAssign
  = col:Identifier _ "=" _ value:Atom { return { col, value }; }

UpdateQuery
  = "=" _ tbl:TableRef _ "<" _ assigns:UpdateAssignList
    where:(_ @WhereClause)?
    returning:(_ @ReturningClause)? {
      return {
        kind: "update",
        table: tbl,
        assigns,
        where: where ? where.value : null,
        returning: returning || null,
      };
    }

UpdateAssignList
  = first:UpdateAssign rest:(_ "," _ @UpdateAssign)* { return [first, ...rest]; }

UpdateAssign
  = col:Identifier _ op:UpdateAssignOp _ value:Atom {
      return { col, op, value };
    }

UpdateAssignOp
  = "+=" / "-=" / "*=" / "/=" / "="

DeleteQuery
  = "-" _ tbl:TableRef
    where:(_ @WhereClause)?
    returning:(_ @ReturningClause)? {
      return {
        kind: "delete",
        table: tbl,
        where: where ? where.value : null,
        returning: returning || null,
      };
    }

ReturningClause
  = ">" cols:ColList { return cols; }

CTEBlock
  = first:CTEDef rest:(_ "," _ @CTEDef)* (_ ",")? {
      return [first, ...rest];
    }

CTEDef
  = "{" _ body:MainQuery _ "}" "@" name:Identifier {
      return { name, body };
    }

MainQuery
  = from:TableRef? clauses:(_ @Clause)* {
      const out = {
        from: from || null,
        select: null,
        joins: [],
        where: null,
        group: null,
        having: null,
        order: null,
        limit: null,
      };
      for (const c of clauses) {
        if (c.kind === "join") out.joins.push(c.value);
        else out[c.kind] = c.value;
      }
      return out;
    }

Clause
  = SelectClause
  / WhereClause
  / JoinClause
  / GroupClause
  / HavingClause
  / OrderClause
  / LimitClause

SelectClause
  = ">" cols:ColList { return { kind: "select", value: cols }; }

WhereClause
  = "?" expr:OrExpr { return { kind: "where", value: expr }; }

JoinClause
  = "+" jt:JoinType? table:TableRef on:OnClause? {
      return { kind: "join", value: { joinType: jt || "inner", table, on } };
    }

JoinType
  = "<" { return "left"; }
  / ">" { return "right"; }
  / "*" { return "full"; }
  / "~" { return "cross"; }

OnClause
  = "[" expr:OrExpr "]" { return expr; }

GroupClause
  = "#" cols:ColRefList { return { kind: "group", value: cols }; }

HavingClause
  = ":" expr:OrExpr { return { kind: "having", value: expr }; }

OrderClause
  = "$" items:OrderItemList { return { kind: "order", value: items }; }

LimitClause
  = "~" lim:Integer page:("p" @Integer)? {
      return { kind: "limit", value: { limit: lim, page: page == null ? 1 : page } };
    }

TableRef
  = name:DottedName alias:("@" @Identifier)? {
      return { name, alias: alias || null };
    }

DottedName
  = $(Identifier ("." Identifier)*)

ColList
  = first:ColExpr rest:(_ "," _ @ColExpr)* { return [first, ...rest]; }

ColExpr
  = "*" { return { type: "star" }; }
  / table:Identifier "." "*" { return { type: "qstar", table }; }
  / expr:Predicate alias:("@" @Identifier)? {
      return { type: "col", expr, alias: alias || null };
    }

ColRefList
  = first:QualifiedId rest:(_ "," _ @QualifiedId)* { return [first, ...rest]; }

OrderItemList
  = first:OrderItem rest:(_ "," _ @OrderItem)* { return [first, ...rest]; }

OrderItem
  = "-" col:QualifiedId { return { col, dir: "desc" }; }
  / "+" col:QualifiedId { return { col, dir: "asc" }; }
  / col:QualifiedId      { return { col, dir: "asc" }; }

OrExpr
  = first:AndExpr rest:(_ "|" _ @AndExpr)* { return flatOr([first, ...rest]); }

AndExpr
  = first:Predicate rest:(_ "," _ @Predicate)* { return flatAnd([first, ...rest]); }

Predicate
  = "!" _ p:NegatablePredicate { return { type: "not", expr: p }; }
  / NegatablePredicate
  / left:Atom op:CompareOp right:Atom {
      return { type: "compare", left, op, right };
    }
  / Atom

NegatablePredicate
  = col:QualifiedId "[" _ source:InSource _ "]" {
      return { type: "in", col, source };
    }
  / col:QualifiedId "%" pattern:StringLiteral {
      return { type: "like", col, pattern };
    }
  / "^(" _ q:Start _ ")" {
      return { type: "exists", query: q };
    }

InSource
  = "(" _ q:Start _ ")" { return { kind: "subquery", query: q }; }
  / items:LiteralList { return { kind: "list", items }; }
  / name:Identifier { return { kind: "ref", name }; }

CompareOp
  = "<>" { return "<>"; }
  / "!=" { return "!="; }
  / ">=" { return ">="; }
  / "<=" { return "<="; }
  / "="  { return "="; }
  / ">"  { return ">"; }
  / "<"  { return "<"; }

Atom
  = NumberLiteral
  / StringLiteral
  / CaseExpr
  / FunctionCall
  / QualifiedId
  / "(" _ expr:OrExpr _ ")" { return { type: "group", expr }; }

CaseExpr
  = "?{" _ body:TernaryExpr _ "}" { return body; }

TernaryExpr
  = cond:CoalesceExpr _ "?" _ then:TernaryExpr _ ":" _ tail:TernaryExpr {
      if (tail && tail.type === "case") {
        return {
          type: "case",
          whens: [{ when: cond, then }, ...tail.whens],
          else: tail.else,
        };
      }
      return { type: "case", whens: [{ when: cond, then }], else: tail };
    }
  / CoalesceExpr

CoalesceExpr
  = first:OrExpr rest:(_ "??" _ @OrExpr)* {
      if (rest.length === 0) return first;
      const items = [first, ...rest];
      // flatten: if any item is itself a coalesce, splice it in
      const flat = [];
      for (const it of items) {
        if (it && it.type === "coalesce") flat.push(...it.items);
        else flat.push(it);
      }
      return { type: "coalesce", items: flat };
    }

FunctionCall
  = name:Identifier "(" _ args:FuncArgList? _ ")" {
      return { type: "func", name, args: args || [] };
    }

FuncArgList
  = first:OrExpr rest:(_ "," _ @OrExpr)* { return [first, ...rest]; }

QualifiedId
  = first:Identifier rest:("." @Identifier)* {
      return rest.length === 0
        ? { type: "id", name: first }
        : { type: "qid", parts: [first, ...rest] };
    }

LiteralList
  = first:Literal rest:(_ "," _ @Literal)* { return [first, ...rest]; }

Literal
  = NumberLiteral / StringLiteral

Identifier
  = $([a-zA-Z_][a-zA-Z0-9_]*)

StringLiteral
  = '"' chars:$('\\' . / [^"\\])* '"' {
      return { type: "str", value: chars.replace(/\\(.)/g, "$1") };
    }

NumberLiteral
  = n:$("-"? [0-9]+ ("." [0-9]+)?) { return { type: "num", value: Number(n) }; }

Integer
  = n:$([0-9]+) { return parseInt(n, 10); }

_ "whitespace"
  = [ \t\r\n]*
