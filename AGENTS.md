# House rules

- Work on master. Every successful pass ends with commit + `git push origin master`; no feature branches unless asked for one.
- Diagnostic-first: read-only investigation and a report before any code change.
- Surgical str_replace edits, never full-file rewrites; `git add` only changed files.
- Spanish-first UI. `es.json` / `en.json` keep exact key parity; EN locale fully English, ES fully Spanish; all user-facing strings go through the catalogs.
- Verify before push: `npm run build && npx tsc --noEmit` (unpiped).
- Never add `backdrop-filter`, `transform`, `filter`, `perspective`, `will-change` or `contain` on any ancestor of drag surfaces, portaled elements or modals (breaks dnd-kit).
- Never validate env vars at module scope; read them inside handlers.
- Money is integer cents (`toCents` / `sumCents` / `formatMoney`).
- Vercel Hobby plan: `maxDuration` ≤ 60; slice long jobs.
- Prisma: `db push`, no migrations. Schema changes hit the live DB, so show the SQL and wait for OK first.
- Multi-machine: `git fetch` before schema edits. PowerShell uses `;`, not `&&`.
