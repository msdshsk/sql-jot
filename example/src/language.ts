import * as monaco from "monaco-editor";

export function registerSqlEmmetLanguage() {
  monaco.languages.register({ id: "sql-emmet" });

  monaco.languages.setMonarchTokensProvider("sql-emmet", {
    defaultToken: "",
    tokenizer: {
      root: [
        [/"([^"\\]|\\.)*"/, "string"],
        [/\d+(\.\d+)?/, "number"],
        [/\+=|-=|\*=|\/=/, "operator.compound"],
        [/<>|!=|>=|<=/, "operator.compare"],
        [/[><?#:$~|=%]/, "operator"],
        [/[+\-]/, "operator.verb"],
        [/[(){}\[\],]/, "delimiter"],
        [/@/, "tag"],
        [/[a-zA-Z_][a-zA-Z0-9_]*/, "identifier"],
        [/\s+/, "white"],
      ],
    },
  });

  monaco.editor.defineTheme("sql-emmet-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "operator.verb", foreground: "ff9d6e", fontStyle: "bold" },
      { token: "operator.compound", foreground: "c586c0" },
      { token: "operator.compare", foreground: "569cd6" },
      { token: "operator", foreground: "569cd6" },
      { token: "delimiter", foreground: "808080" },
      { token: "tag", foreground: "9cdcfe" },
      { token: "identifier", foreground: "dcdcaa" },
      { token: "string", foreground: "ce9178" },
      { token: "number", foreground: "b5cea8" },
    ],
    colors: {},
  });
}
