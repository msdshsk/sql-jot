import { describe, expect, it } from "vitest";
import { expand } from "../src/index.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("complex realistic queries", () => {
  it("aggregation + HAVING + IN-subquery + ORDER + LIMIT", () => {
    const sql = expand(
      "orders@o>o.user_id,sum(o.total)@total" +
      "?o.user_id[(active_users>id)]" +
      "#o.user_id" +
      ":total>1000" +
      "$-total" +
      "~10",
    );
    expect(norm(sql)).toBe(
      "SELECT o.user_id, sum(o.total) AS total " +
        "FROM orders o " +
        "WHERE o.user_id IN (SELECT id FROM active_users) " +
        "GROUP BY o.user_id " +
        "HAVING total > 1000 " +
        "ORDER BY total DESC " +
        "LIMIT 10",
    );
  });

  it("multi-CTE feeding a JOIN with aggregation and HAVING", () => {
    const sql = expand(
      "{users>id?active=1}@au," +
      '{orders>user_id,total?status="paid"}@po,' +
      "au@u+po@p[u.id=p.user_id]" +
      ">u.id,sum(p.total)@spent" +
      "#u.id" +
      ":spent>500" +
      "$-spent",
    );
    expect(norm(sql)).toBe(
      "WITH au AS (SELECT id FROM users WHERE active = 1), " +
        "po AS (SELECT user_id, total FROM orders WHERE status = 'paid') " +
        "SELECT u.id, sum(p.total) AS spent " +
        "FROM au u " +
        "INNER JOIN po p ON u.id = p.user_id " +
        "GROUP BY u.id " +
        "HAVING spent > 500 " +
        "ORDER BY spent DESC",
    );
  });

  it("self-join via two aliases on the same table", () => {
    const sql = expand(
      "users@a+users@b[a.parent_id=b.id]>a.name,b.name@parent_name",
    );
    expect(norm(sql)).toBe(
      "SELECT a.name, b.name AS parent_name " +
        "FROM users a " +
        "INNER JOIN users b ON a.parent_id = b.id",
    );
  });

  it("UPDATE with compound assign and IN-subquery WHERE", () => {
    const sql = expand(
      "=users<count+=1,active=1?id[(active_user_ids>id)]",
    );
    expect(norm(sql)).toBe(
      "UPDATE users SET count = count + 1, active = 1 " +
        "WHERE id IN (SELECT id FROM active_user_ids)",
    );
  });

  it("DELETE with mixed AND/OR + IN subquery", () => {
    const sql = expand(
      '-audit_log?action="login",user_id[(deleted_users>id)]|created_at<"2025-01-01"',
    );
    expect(norm(sql)).toBe(
      "DELETE FROM audit_log " +
        "WHERE (action = 'login' AND user_id IN (SELECT id FROM deleted_users)) " +
        "OR created_at < '2025-01-01'",
    );
  });

  it("INSERT...SELECT with WHERE-filtered source", () => {
    const sql = expand(
      "+archive(user_id,name)<" +
      '(users>id,name?active=0,last_login<"2025-01-01")',
    );
    expect(norm(sql)).toBe(
      "INSERT INTO archive (user_id, name) " +
        "SELECT id, name FROM users " +
        "WHERE active = 0 AND last_login < '2025-01-01'",
    );
  });

  it("nested CTE inside IN-subquery", () => {
    const sql = expand(
      "users>name?id[({orders>user_id?total>1000}@big>user_id)]",
    );
    expect(norm(sql)).toBe(
      "SELECT name FROM users " +
        "WHERE id IN (" +
        "WITH big AS (SELECT user_id FROM orders WHERE total > 1000) " +
        "SELECT user_id FROM big" +
        ")",
    );
  });

  it("LEFT JOIN used purely for filtering (qstar pattern)", () => {
    const sql = expand(
      "wholesalers@w" +
      ">w.*" +
      '?f.child_code["a","b","c"]' +
      "+<formats@f[f.id=w.format_id]" +
      "$-w.id" +
      "~50p2",
    );
    expect(norm(sql)).toBe(
      "SELECT w.* " +
        "FROM wholesalers w " +
        "LEFT JOIN formats f ON f.id = w.format_id " +
        "WHERE f.child_code IN ('a', 'b', 'c') " +
        "ORDER BY w.id DESC " +
        "LIMIT 50 OFFSET 50",
    );
  });

  it("LIKE with IN and OR mixed", () => {
    const sql = expand(
      'users?name%"smith"|email%"@example.com",status[1,2,3]',
    );
    expect(norm(sql)).toBe(
      "SELECT * FROM users " +
        "WHERE name LIKE '%smith%' OR (email LIKE '%@example.com%' AND status IN (1, 2, 3))",
    );
  });

  it("schema-qualified tables across a 3-table JOIN", () => {
    // Note: arithmetic inside aggregates (e.g. sum(qty*price)) is not yet
    // supported. Stick to single-column aggregates here.
    const sql = expand(
      "public.users@u" +
      "+public.orders@o[u.id=o.user_id]" +
      "+public.line_items@li[o.id=li.order_id]" +
      ">u.name,sum(li.qty)@units" +
      "#u.name" +
      "$-units",
    );
    expect(norm(sql)).toBe(
      "SELECT u.name, sum(li.qty) AS units " +
        "FROM public.users u " +
        "INNER JOIN public.orders o ON u.id = o.user_id " +
        "INNER JOIN public.line_items li ON o.id = li.order_id " +
        "GROUP BY u.name " +
        "ORDER BY units DESC",
    );
  });
});
