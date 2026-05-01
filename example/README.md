# sql-emmet example

Live demo of `sql-emmet` running inside a Monaco editor.

## Run

```bash
cd example
npm install
npm run dev
```

Open http://localhost:5173.

## What you get

- **Left pane**: type the emmet shorthand
- **Right pane**: live SQL preview
- **Ctrl+E** in the left pane: expand the shorthand inline (replaces input with SQL)
- **Quick-load buttons** at the top: pre-canned examples

The example imports `sql-emmet` directly from `../src/`, so changes to the
parser/compiler are picked up by Vite HMR.
