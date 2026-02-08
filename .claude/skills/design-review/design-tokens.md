# Design Tokens Reference

All values sourced from `app/globals.css` and UI component files. Always use semantic token names in Tailwind classes.

## Color System (CSS Custom Properties — HSL)

### Brand Colors
| Token | HSL | Approx Hex | Usage |
|---|---|---|---|
| `--primary` | `173 58% 39%` | #0d9488 (teal-600) | CTAs, active states, links, focus rings |
| `--primary-foreground` | `0 0% 100%` | #ffffff | Text on primary backgrounds |
| `--secondary` | `215 19% 35%` | #475569 (slate-600) | Secondary actions, muted buttons |
| `--secondary-foreground` | `0 0% 98%` | #fafafa | Text on secondary backgrounds |
| `--accent` | `173 58% 39%` | same as primary | Icons, highlights, subtle emphasis |

### Semantic Colors
| Token | HSL | Approx Hex | Usage |
|---|---|---|---|
| `--success` | `142 71% 45%` | #16a34a | Positive states, confirmations, "Fully Received" |
| `--warning` | `38 92% 50%` | #f59e0b (amber-500) | Caution, pending, outstanding amounts |
| `--info` | `217 91% 60%` | #3b82f6 (blue-500) | Informational messages |
| `--destructive` | `0 70% 56%` | #dd4040 | Errors, deletions, "Owing" quantities |

### Surface Colors
| Token | HSL | Usage |
|---|---|---|
| `--background` | `0 0% 100%` | Page background |
| `--foreground` | `222 47% 11%` | Primary text |
| `--card` / `--card-foreground` | `0 0% 100%` / `222 47% 11%` | Card surfaces |
| `--muted` | `210 40% 96%` | Disabled states, subtle backgrounds |
| `--muted-foreground` | `215 16% 47%` | Subtitles, descriptions, secondary text |
| `--border` | `214 32% 91%` | Borders |
| `--ring` | `173 58% 39%` | Focus rings (matches primary) |
| `--radius` | `0.5rem` | Default border radius (8px) |

### Tailwind Usage
```
text-primary          → Teal text
bg-primary            → Teal background
text-destructive      → Red text (for owing/errors)
text-muted-foreground → Grey secondary text
bg-muted/50           → Subtle hover backgrounds
border-l-primary      → Teal left border accent
border-l-warning      → Amber left border accent
```

## Typography Scale

Defined in `globals.css` `@layer base`:
| Element | Tailwind Classes | Notes |
|---|---|---|
| Page title (h1) | `text-2xl font-bold` | Global base style |
| Section heading (h2) | `text-xl font-semibold` | Global base style |
| Subsection (h3) | `text-lg font-medium` | Global base style |
| PageToolbar title | `text-xl font-semibold tracking-tight` | Compact variant |
| Page subtitle | `text-sm text-muted-foreground` | Below title or as tooltip |
| Table header cells | `text-sm font-medium text-muted-foreground` | Via TableHead component |
| Table body cells | `text-sm` (14px) | Default size |
| Badges | `text-xs font-semibold` (12px) | Rounded-full pills |
| Small labels | `text-xs text-muted-foreground` | Metadata, timestamps |

## Spacing Scale

| Context | Value | Tailwind |
|---|---|---|
| Root container padding | 16px mobile, 24px desktop | `px-4 md:px-6 py-2` |
| Page section gaps (modern) | 8px | `space-y-2` |
| Page section gaps (legacy) | 24px | `space-y-6` |
| Card grid gaps | 16px | `gap-4` |
| Detail page two-column | 24px | `gap-6` |
| Table cell padding | 10px vert, 16px horiz | `px-4 py-2.5` |
| Table header height | 48px | `h-12` |
| Compact button/input height | 36px | `h-9` |
| Standard button height | 40px | `h-10` |

## Dark Mode

Dark mode uses `.dark` class strategy. Key overrides:
- `--primary` lightens to `173 58% 50%`
- `--background` inverts to `222 47% 11%`
- `--destructive` darkens to `0 62% 30%`
- All surface colors invert appropriately
