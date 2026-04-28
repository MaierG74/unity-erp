# Turbopack Tailwind Dev Cache Issue

## Status

Chosen fix: keep Tailwind v4 on the PostCSS compiler path and disable the Turbopack dev filesystem cache.

## Background

`next dev` on Turbopack previously showed runaway `.next/turbopack/` growth on the Mac Mini, with cache chunks growing until the machine ran out of memory. The temporary local workaround was to launch development with `next dev --webpack`.

An attempted native Lightning CSS path was ruled out. `app/globals.css` intentionally uses Tailwind v4 CSS-first source detection:

```css
@import "tailwindcss" source(none);
@source ".";
```

Those directives are Tailwind syntax, not plain CSS. Without `@tailwindcss/postcss`, Turbopack's Lightning CSS parser fails before Tailwind can compile them.

## Fix

Keep `postcss.config.mjs` with `@tailwindcss/postcss`.

Disable the dev-mode Turbopack filesystem cache in `next.config.mjs`:

```js
experimental: {
  cpus: 2,
  staticGenerationMaxConcurrency: 1,
  turbopackFileSystemCacheForDev: false,
}
```

The production build cache setting is unchanged.

Patch versions are bumped to pick up upstream Turbopack and Tailwind fixes:

- `next` from `16.1.3` to `16.2.4`
- `tailwindcss` from `4.2.1` to `4.2.4`
- `@tailwindcss/postcss` from `4.2.1` to `4.2.4`

`.claude/launch.json` now runs plain `next dev` so local development uses Turbopack again without the webpack workaround.

## Verification

Before release, verify:

1. `pnpm install`
2. `rm -rf .next`
3. `pnpm run dev`
4. Smoke `/`, `/dashboard`, and `/payroll-review`.
5. Sample RSS and `.next/turbopack/` size at boot, 60s, 120s, and 180s.
6. `pnpm run build`
7. `pnpm run lint`

Expected result: Turbopack boots without `--webpack`, styles render normally, the dev cache remains bounded, and the production build path still passes.

## Rollback

Revert the config and dependency bump commit to restore the prior webpack workaround and package versions. No database, schema, API, or user-facing runtime state is involved.
