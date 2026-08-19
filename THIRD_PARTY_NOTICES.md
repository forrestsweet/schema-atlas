# Third-party notices

- `node-sql-parser` (Apache-2.0) parses MySQL SQL into an AST. The AST-to-schema
  mapping follows the same proven pipeline used by DrawDB, while the adapter in
  this project is intentionally limited to this application's normalized model.
- `@antv/g6` (MIT) renders the relationship graph on Canvas.
- `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` provide the
  browser-safe Pi agent loop and model streaming used by the AI sidebar.
- `@assistant-ui/react`, `@assistant-ui/react-pi`, and the assistant-ui registry
  components provide the Pi runtime adapter and chat primitives.
- shadcn/ui registry components provide shared controls and the resizable layout.
- DrawDB (AGPL-3.0) was studied as the behavioral reference for MySQL DDL import.
  No DrawDB UI or canvas code is bundled here.
