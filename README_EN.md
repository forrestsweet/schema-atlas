# Schema Atlas

[中文](README.md) · [English](README_EN.md)

A local-first visualization and AI analysis tool for large MySQL schemas. Import DDL to explore tables, columns, comments, and foreign-key relationships—without connecting to a database or executing SQL.

![Schema Atlas relationship canvas](public/screenshots/schema-overview.jpg)

## Features

- Import `.sql` / `.txt`, drag and drop files, or paste MySQL DDL
- Parse inside a Web Worker to keep the UI responsive
- Detect columns, comments, primary keys, indexes, inline foreign keys, and `ALTER TABLE` foreign keys
- AntV G6 Canvas graph with zoom, pan, search, and focus controls
- Fixed-height table cards with internal scrolling for large column sets
- A related subgraph view that focuses on one-hop neighbors—useful for schemas with 2,300+ tables
- Import, rename, switch, and delete multiple schemas
- Schema Copilot powered by the Pi Agent Loop and assistant-ui
- AI tools for schema search, table inspection, relationship analysis, SQL generation, and canvas focus
- Independent local AI conversation history for every schema
- Default shadcn/ui components with the neutral theme

## Local first

Schema Atlas never connects to your database. DDL, parsed schemas, and AI conversations are stored in browser IndexedDB; model settings are stored in browser localStorage. Schema context is sent to your configured model provider only when you use Copilot.

![Schema Atlas local architecture](public/screenshots/architecture.svg)

## Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS
- shadcn/ui, assistant-ui
- AntV G6
- `node-sql-parser` + Web Worker
- Pi Agent Loop
- IndexedDB

## Quick start

Requires Node.js 20+.

Run without installing:

```bash
npx schema-atlas@latest
```

The command selects an available port, starts the local server, and opens your browser. Or install it globally:

```bash
npm install -g schema-atlas
schema-atlas
```

Common options:

```bash
schema-atlas --port 4173
schema-atlas --host 0.0.0.0
schema-atlas --no-open
```

For source development:

```bash
git clone https://github.com/forrestsweet/schema-atlas.git
cd schema-atlas
npm install
npm run dev
```

Open the local URL printed in your terminal, then paste or select a MySQL DDL file.

## Schema Copilot

Open Copilot, choose a provider and model in settings, and enter an API key. The app supports Pi's built-in model catalog and custom OpenAI-compatible endpoints.

The AI only reads imported DDL. It does not connect to a database, execute SQL, or access production data.

## Large schemas

Generate a local fixture without committing it to Git:

```bash
npm run generate:large-schema -- 2300 work/large-schema.sql
```

For large schemas, search for a table first and use the related subgraph view to reduce the visible graph.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Data removal

Deleting a schema from the schema menu also removes its DDL, parsed result, and associated AI conversations. Model settings can be cleared through browser site data.

## Third-party software

Schema Atlas combines established open-source projects. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
