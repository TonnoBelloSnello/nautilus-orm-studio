# Nautilus Studio

Nautilus Studio is a small Next.js admin surface for [nautilus](https://github.com/y0gm4/nautilus).

It provides:

- schema browsing
- table data inspection and editing
- a raw SQL query console

This package is not meant to be installed directly by end users. It is intended to be installed and wired up by the `nautilus-orm` module inside a Nautilus workspace.

## Local development

This app expects access to:

- a `schema.nautilus` file in the workspace root, or `NAUTILUS_SCHEMA_PATH`
- the `nautilus` CLI binary available locally
- any database environment variables required by your schema

Run the app with:

```bash
npm install
npm run dev
```

Open `http://localhost:3000` to use the studio.
