---
name: tailwind-v4
description: "Tailwind CSS v4 and shadcn v4 reference for Unity ERP. Use when writing or editing Tailwind classes, modifying globals.css or @theme config, adding shadcn components, or any frontend styling work. Prevents writing outdated v3 syntax from training data."
argument-hint: "[styling task or component being built]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, WebFetch
---

# Tailwind v4 + shadcn v4 Reference

Task: **$ARGUMENTS**

> **Why this skill exists:** Tailwind v4 and shadcn v4 shipped after Claude's training data.
> This skill prevents writing v3 syntax that silently breaks or gets ignored.
> Consult this BEFORE writing any Tailwind classes or CSS.

---

## Our Setup (Unity ERP)

| Package | Version | Notes |
|---------|---------|-------|
| `tailwindcss` | 4.2.1 | CSS-first config, no `tailwind.config.ts` |
| `@tailwindcss/postcss` | 4.2.1 | Single PostCSS plugin (replaces `tailwindcss` + `autoprefixer`) |
| `tw-animate-css` | 1.4.0 | Replaces `tailwindcss-animate` |
| `shadcn` | 4.0.2 | New package name (was `shadcn-ui`) |
| Config | `app/globals.css` | All theme config lives in `@theme` block |
| `components.json` | `tailwind.config: ""` | Empty string = Tailwind v4 CSS-first mode |

---

## Critical Syntax Changes (v3 -> v4)

### 1. Renamed Utilities (THESE WILL SILENTLY FAIL IF WRONG)

| v3 (WRONG) | v4 (CORRECT) | What changed |
|------------|--------------|--------------|
| `shadow-sm` | `shadow-xs` | Shadow scale shifted down one step |
| `shadow` | `shadow-sm` | Shadow scale shifted down one step |
| `drop-shadow-sm` | `drop-shadow-xs` | Same shift |
| `drop-shadow` | `drop-shadow-sm` | Same shift |
| `blur-sm` | `blur-xs` | Same shift |
| `blur` | `blur-sm` | Same shift |
| `rounded-sm` | `rounded-xs` | Border radius scale shifted down |
| `rounded` | `rounded-sm` | Border radius scale shifted down |
| `ring` | `ring-3` | Default ring width changed 3px -> 1px |
| `outline-none` | `outline-hidden` | `outline-none` now sets `outline-style: none` |
| `bg-gradient-to-r` | `bg-linear-to-r` | Gradient utilities renamed |
| `bg-gradient-to-b` | `bg-linear-to-b` | All gradient directions renamed |

### 2. Removed Utilities

These **do not exist** in v4. Do not write them:

| Removed | Replacement |
|---------|-------------|
| `bg-opacity-50` | `bg-black/50` (modifier syntax) |
| `text-opacity-75` | `text-white/75` |
| `border-opacity-*` | `border-red-500/50` |
| `ring-opacity-*` | `ring-primary/50` |
| `placeholder-opacity-*` | Use opacity modifier |
| `flex-shrink-0` | `shrink-0` |
| `flex-grow` | `grow` |
| `overflow-ellipsis` | `text-ellipsis` |
| `decoration-slice` | `box-decoration-slice` |
| `decoration-clone` | `box-decoration-clone` |
| `transform` (standalone) | Not needed, auto-applied |
| `transform-gpu` | Not needed |

### 3. Changed Syntax

| v3 (WRONG) | v4 (CORRECT) | Notes |
|------------|--------------|-------|
| `bg-[--brand-color]` | `bg-(--brand-color)` | Parentheses for CSS vars, not brackets |
| `!bg-red-500` | `bg-red-500!` | Important modifier goes at END |
| `first:*:pt-0` | `*:first:pt-0` | Variant stacking is now LEFT to RIGHT |
| `grid-cols-[max-content,auto]` | `grid-cols-[max-content_auto]` | Underscores for spaces, not commas |

### 4. Changed Default Behaviors

| Behavior | v3 | v4 |
|----------|----|----|
| Default border color | `gray-200` | `currentColor` |
| Default ring width | 3px | 1px |
| Default ring color | `blue-500` | `currentColor` |
| `hover:` on mobile | Always fires on tap | Only fires if device supports hover (`@media (hover: hover)`) |
| `<div class="hidden flex">` | Shows as flex | Stays hidden (`hidden` attribute wins) |
| Placeholder color | `gray-400` | Current text color at 50% opacity |
| Button cursor | `pointer` | `default` (browser default) |
| `space-*` selector | margin-top on siblings | margin-bottom on `:not(:last-child)` |

---

## CSS Config Syntax (globals.css)

### Directives

| Directive | Purpose | Replaces |
|-----------|---------|----------|
| `@import "tailwindcss"` | Load Tailwind | `@tailwind base/components/utilities` |
| `@theme { }` | Define design tokens | `tailwind.config.ts` theme section |
| `@theme inline { }` | Tokens referencing other vars | Use when value is `var(--something)` that may change |
| `@utility name { }` | Custom utilities with variant support | `@layer utilities { .name { } }` |
| `@custom-variant name (selector)` | Custom variants | Plugin API `addVariant()` |
| `@source "path"` | Scan additional directories | `content` array in config |
| `@source inline("classes")` | Safelist classes | `safelist` in config |
| `@variant name { }` | Use Tailwind variant in custom CSS | New in v4 |
| `@plugin "path"` | Load legacy JS plugin | Compatibility bridge |
| `@config "path"` | Load legacy JS config | Compatibility bridge |

### Theme Namespaces

When adding to `@theme`, the variable prefix determines which utilities are generated:

| Prefix | Generates |
|--------|-----------|
| `--color-*` | `bg-*`, `text-*`, `border-*`, `ring-*`, etc. |
| `--font-*` | `font-*` (family) |
| `--text-*` | `text-*` (size) |
| `--font-weight-*` | `font-*` (weight) |
| `--spacing-*` | `p-*`, `m-*`, `w-*`, `h-*`, `gap-*`, etc. |
| `--radius-*` | `rounded-*` |
| `--shadow-*` | `shadow-*` |
| `--animate-*` | `animate-*` (put `@keyframes` inside `@theme`) |
| `--breakpoint-*` | Responsive variants (`sm:`, `md:`, etc.) |
| `--ease-*` | `ease-*` |

### Functions

| Function | Purpose | Example |
|----------|---------|---------|
| `var(--color-*)` | Reference theme token | `color: var(--color-primary)` |
| `--spacing(N)` | Compute from spacing base | `margin: --spacing(4)` = `calc(var(--spacing) * 4)` |
| `--alpha(color / %)` | Adjust opacity | `--alpha(var(--color-primary) / 50%)` |
| `theme()` | **DEPRECATED** — use `var()` | `theme(--breakpoint-xl)` still works but prefer `var()` |

---

## shadcn v4

### CLI

```bash
# Add a component (new package name)
pnpm dlx shadcn@latest add button

# Add all components
pnpm dlx shadcn@latest add --all

# Preview before installing
pnpm dlx shadcn@latest view button

# Diff local vs registry
pnpm dlx shadcn@latest add --diff button

# Available migrations
pnpm dlx shadcn@latest migrate radix    # @radix-ui/react-* -> radix-ui
pnpm dlx shadcn@latest migrate rtl      # physical -> logical CSS (ml -> ms)
pnpm dlx shadcn@latest migrate icons    # switch icon library
```

### Key Changes from Old shadcn-ui

1. **Package**: `shadcn-ui` -> `shadcn` (just `shadcn@latest`)
2. **Style**: Only `new-york` style (no more `default`)
3. **forwardRef removed**: Components use plain functions + `React.ComponentProps<>` + `data-slot`
4. **Radix unified**: All `@radix-ui/react-*` packages -> single `radix-ui` package
5. **Animation**: `tailwindcss-animate` -> `tw-animate-css` (CSS import, not plugin)
6. **`components.json`**: `tailwind.config` field must be empty string `""` for v4
7. **Chart colors**: Use `"var(--chart-1)"` not `"hsl(var(--chart-1))"` in chartConfig

### Our `components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

---

## Quick Decision Guide

**"Should I use `@layer utilities` or `@utility`?"**
-> `@utility` — it auto-supports all variants (hover:, lg:, dark:, etc.)

**"Where do I add a new color?"**
-> Add CSS var in `:root` and `.dark` blocks, then map it in `@theme { --color-name: hsl(var(--name)); }`

**"How do I add a new animation?"**
-> Inside `@theme { --animate-name: name 0.3s ease; @keyframes name { ... } }`

**"Can I use `theme()` function?"**
-> Deprecated. Use `var(--color-*)`, `var(--spacing)`, etc. directly.

**"How do I reference a CSS variable in a class?"**
-> `bg-(--my-var)` with parentheses, NOT `bg-[--my-var]` with brackets.

**"How do I add opacity to a theme color?"**
-> `bg-primary/50` (modifier syntax). Never use `bg-opacity-*`.

---

## When Unsure

If you encounter a Tailwind class or pattern not covered here, **fetch the current docs** before guessing:
- `https://tailwindcss.com/docs/{topic}` for Tailwind
- `https://ui.shadcn.com/docs/{topic}` for shadcn

Do NOT rely on training data for Tailwind syntax — it is outdated.
