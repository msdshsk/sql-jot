export interface Example {
  label: string;
  source: string;
}

export const EXAMPLES: Example[] = [
  {
    label: "select+group",
    source: "tbl@a>name,sum(price)@x#name:x<5000$-x",
  },
  {
    label: "join+where",
    source: "tbl@a>c1,c2,c3?c2=x,c3=1+tbl2@b",
  },
  {
    label: "cte",
    source: "{tbl>*?c1=2}@sub+users@u[sub.id=u.outer_id]",
  },
  {
    label: "insert",
    source: '+users<name="alice",age=30',
  },
  {
    label: "insert multi",
    source: '+users<{name="alice",age=30},{name="bob",age=25}',
  },
  {
    label: "update +=",
    source: "=users<count+=1?id=5",
  },
  {
    label: "delete",
    source: "-users?id=5",
  },
  {
    label: "like+in+limit",
    source: 'users?name%"john",status["active","pending"]$-created_at~20p2',
  },
  {
    label: "fk auto",
    source: "users@u+orders@o>u.name,o.total?o.total>100",
  },
  {
    label: "multi-hop",
    source: "users+items?qty>5",
  },
  {
    label: "implicit qualify",
    source: "users+orders?total>1000",
  },
  {
    label: "in subquery",
    source: '{audits>user_id?action="login"}@hot+users@u?u.id[hot]',
  },
];
