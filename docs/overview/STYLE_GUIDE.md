# Unity ERP Styling Guide

This guide documents how we style the app: Tailwind CSS utilities + shadcn/ui primitives, with a light design system for consistency.

- Tech: Tailwind CSS, shadcn/ui, Next.js App Router
- Key files:
  - Tailwind config: `tailwind.config.ts`
  - Global CSS: `app/globals.css`
  - UI primitives: `components/ui/*` (e.g., `button.tsx`, `checkbox.tsx`, `label.tsx`)
  - Layout shell: `components/layout/*`

## Core Principles
- __Utility-first__: Prefer Tailwind utilities for spacing, layout, color, and type.
- __Small, reusable primitives__: Use shadcn/ui components for consistent look and a11y.
- __Variants over one-off styles__: Use `cva` variants in shared components (e.g., `Button`).
- __Consistent spacing & rhythm__: Stick to Tailwind spacing scale (`1, 2, 3, 4, 6, 8, 12`).
- __Accessible by default__: Proper labels, focus states, color contrast, keyboard support.
- __Responsive-first__: Mobile-friendly by default; refine with `md:` and up.

## Color & Theme
- __Design tokens (shadcn/tailwind)__
  - Backgrounds: `bg-background`, `bg-card`, `bg-popover`, `bg-muted`
  - Text: `text-foreground`, `text-muted-foreground`
  - Surfaces/borders: `border`, `border-input`
  - Brand/action: `bg-primary`, `text-primary-foreground`
  - Secondary: `bg-secondary`, `text-secondary-foreground`
  - States: `text-destructive`, `bg-destructive`, `text-destructive-foreground`
  - Focus: `ring-ring`

- __Palette & semantics__
  - Use semantic classes over raw colors. Avoid hard-coded hex where possible.
  - Primary = key actions (e.g., “Add Supplier”), links emphasis.
  - Secondary/Outline = secondary actions and neutral CTAs.
  - Muted = subtle backgrounds, table rows hover, input adornments.
  - Destructive = delete/irreversible actions and error banners.

- __Destructive tone update (2025‑08)__
  - Light mode destructive color softened to reduce visual intensity while maintaining contrast.
  - CSS token change in `app/globals.css`:
    - `--destructive` from `0 84.2% 60.2%` → `0 70% 56%`.
  - This keeps white `--destructive-foreground` for accessible contrast and uses the same token everywhere (`variant="destructive"`, `bg-destructive`).
  - Hover still uses opacity (`/90`) so no component-level tweaks are required.
  - Added `destructiveSoft` button variant for pastel delete actions (uses `bg-destructive/15` + subtle border). Prefer this for table row deletes in light mode.

- __Light/Dark mode mapping__
  - Variables are defined in CSS and flipped for `.dark` automatically (via shadcn template).
  - Keep all components themed via tokens so both modes stay in sync.
  - Example reference (conceptual):
    - Light: `--background: 0 0% 100%`, `--foreground: 240 10% 3.9%`
    - Dark: `--background: 240 10% 3.9%`, `--foreground: 0 0% 98%`
  - Do not use fixed utilities like `bg-white`/`text-black` on surfaces; prefer tokenized classes.

- __Background layering__
  - Page: `bg-background`
  - Contained surfaces: `bg-card` + `border`
- Popovers/menus: `bg-popover` + `border`
  - Subtle areas/chips: `bg-muted` (ensure text uses `text-foreground` or within a labeled control)

- __Borders & elevation__
  - Default card: `rounded-xl border bg-card shadow-sm`
  - Interactive hover: `hover:bg-muted` for subtle highlighting
  - Inputs: `border-input` and focus with `focus:ring-2 focus:ring-ring`

- __Text & icon color__
  - Default text: `text-foreground`
  - Subtext/meta: `text-muted-foreground`
  - Icons in controls: `h-4 w-4 text-muted-foreground`

- __Focus & states__
  - Focus: `focus:outline-none focus:ring-2 focus:ring-ring`
  - Errors: use `text-destructive` for text; `bg-destructive text-destructive-foreground` for solid alerts.
  - Disabled: decrease opacity or use muted colors with `aria-disabled` semantics.

- __Accessibility targets__
  - Body text vs background: AAA preferred, AA minimum (>= 4.5:1).
  - Buttons: foreground vs background AA (>= 4.5:1) including hover.
  - Don’t encode meaning with color alone; add icons/labels.

- __Practical examples__
  - Primary button: `bg-primary text-primary-foreground hover:bg-primary/90`
  - Secondary button: `bg-secondary text-secondary-foreground`
  - Neutral card: `rounded-xl border bg-card shadow-sm`
  - Input: `border-input focus:ring-2 focus:ring-ring`
  - Toolbar: `bg-card border` with children using `text-muted-foreground` where appropriate

- __Do / Avoid__
  - Do: use tokens (`bg-card`, `text-muted-foreground`) to inherit themes.
  - Do: keep control heights consistent; ensure ring color is visible in both modes.
  - Avoid: `bg-white`/`text-black`/raw hex on components; use semantic tokens.
  - Avoid: mixing multiple saturated colors in one view; rely on neutral surfaces with a single accent.

## Typography
- __Typeface__: Inter is our primary and only sanctioned UI typeface. It is loaded globally in `app/layout.tsx` and mapped to the
  Tailwind `font-sans` token, so prefer utilities like `font-sans`/`text-foreground` rather than declaring custom font stacks.
  Do not introduce additional fonts without design sign-off.
- __Application__: Replicate the "Apply FG coverage" control pattern—`Label` set in `text-sm font-medium leading-tight` and
  supporting copy in `text-xs text-muted-foreground`—for similar toggles, settings rows, and metadata blocks so the interface
  maintains consistent hierarchy and comfortable density.
- __Sizes__: Use Tailwind presets (`text-xs`..`text-2xl`). Lists/tables default to `text-sm`.
- __Weights__: Use semantic emphasis (`font-medium` for headings/labels).
- __Line-height__: Default (`leading-normal`) unless compact UI requires `leading-tight`.

## Spacing & Layout
- __Containers__: Use `rounded-xl border bg-card shadow-sm` for card blocks.
- __Toolbar rows__: `flex flex-col gap-3 md:flex-row md:items-center md:justify-between`.
- __Inline controls__: `flex items-center gap-3`.
- __Padding__: Prefer `p-3` for dense toolbars; `p-4` for normal sections.
- __Tables__: Wrap with `overflow-auto` on a rounded/bordered card.
- __Label → input spacing__: 8–12 px. Default to Tailwind `space-y-2` (8 px). Use `space-y-3` (12 px) for airier forms.
- __Field group gaps__: 16–24 px between rows/columns. Default `gap-6` (24 px) on desktop grids.

## Components (shadcn/ui)
- __Buttons__ (`components/ui/button.tsx`)
  - Variants: `default`, `outline`, `secondary`, `ghost`, `destructive`, `destructiveSoft`, `link`.
  - Sizes: `default`, `sm` (`h-9`), `lg`, `icon`.
  - Use: primary actions = `default`; secondary = `outline` or `secondary`.
  - Soft destructive: use `destructiveSoft` for lightweight delete actions (tables, chips). Light mode shows a pastel red background with red text; in dark mode it intentionally renders the strong red (for contrast) using `dark:bg-destructive dark:text-destructive-foreground`. Keep solid `destructive` for confirmation dialogs and high‑severity alerts.
  - Table action pattern: Edit = `ghost` icon button; Delete = `destructiveSoft` icon button with `Trash2` icon.
- __Inputs__
  - Text inputs: rounded, `h-9`, with left icons positioned via `absolute`.
  - Clear buttons in inputs: small icon button on the right; keep hit area `h-6 w-6`.
  - **Number inputs**: Store as `string` in state, convert to `number` only on blur/submit. This allows users to clear the field without it immediately resetting to 0.
    ```tsx
    // ❌ BAD: Cannot clear input - resets to 0 immediately
    const [qty, setQty] = useState(0);
    <Input type="number" value={qty} onChange={e => setQty(Number(e.target.value) || 0)} />
    
    // ✅ GOOD: Can clear input - converts on blur
    const [qty, setQty] = useState<string>('0');
    <Input 
      type="number" 
      value={qty} 
      onChange={e => setQty(e.target.value)}
      onBlur={() => { 
        const num = Number(qty) || 0; 
        // Update parent with number
        onUpdate(num); 
        // Normalize display
        setQty(String(num)); 
      }}
    />
    ```
  - **Currency inputs**: Always round to 2 decimal places and use `step="0.01"`:
    ```tsx
    // For currency (prices, costs)
    const [unitPrice, setUnitPrice] = useState<string>('0');
    <Input 
      type="number" 
      step="0.01"
      value={unitPrice} 
      onChange={e => setUnitPrice(e.target.value)}
      onBlur={() => { 
        const price = Math.round((Number(unitPrice) || 0) * 100) / 100;
        onUpdate(price);
        setUnitPrice(String(price)); 
      }}
    />
    ```
- __Checkbox__ (`components/ui/checkbox.tsx`)
  - Height/width `h-4 w-4`, bordered, uses `data-[state=checked]` styles.
  - Label via `label` or `Label` component; ensure `htmlFor`/`id` are linked.
- __Labels__ (`components/ui/label.tsx`)
  - Use for form field labels; prefer `text-sm text-muted-foreground` for subtle labels.
- __Modals/Sheets/Menus__
  - Use shadcn primitives if/when added; apply `p-4` content padding and `gap-3`.

## Patterns & Examples
### Dialogs / Modals
- Structure: `Dialog` → `DialogContent` → `DialogHeader` + body + `DialogFooter`.
- Content: use `p-6` built-in padding; keep inner body `space-y-3` and constrain long content with `max-h-[70vh] overflow-y-auto`.
- Avoid ring clipping: when a focusable control sits near the left/right edge inside a scrollable modal body, add `overflow-x-visible` to the scroll container so focus rings are not clipped.
- If rings still clip: ensure the modal root allows overflow. Our `DialogContent` includes `overflow-visible` so focus rings can extend past rounded corners.
- Footer: actions on the right; use `Button size="sm" className="h-9"` for compact density.
- Inputs: reuse standard `Input`, `Select`, `Label`; keep placeholder color `placeholder:text-muted-foreground`.
- Borders: prefer `border-input` inside lists; avoid mixed border tokens.
- Example:
```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="max-w-2xl sm:rounded-xl">
    <DialogHeader>
      <DialogTitle>Add Thing</DialogTitle>
    </DialogHeader>
    <div className="space-y-3 max-h-[70vh] overflow-y-auto">
      <Label>Name</Label>
      <Input className="h-9" />
    </div>
    <DialogFooter>
      <Button variant="outline" size="sm" className="h-9">Cancel</Button>
      <Button size="sm" className="h-9">Save</Button>
    </DialogFooter>
  </DialogContent>
  </Dialog>
```

- Edge cases: When a control sits very close to a modal edge, prefer an inset ring to avoid clipping: add `focus:ring-inset focus:ring-offset-0` on the control. If still tight, add a small container padding `px-1`.
- __Search field with icon and clear button__
```tsx
<div className="relative w-full md:w-96">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
  <input
    type="text"
    className="w-full h-9 pl-9 pr-10 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
  />
  <button className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted" />
</div>
```

- __Toolbar with left primary action and right filters__ (used in `SupplierList`)
```tsx
<div className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm md:flex-row md:items-center md:justify-between">
  <Button className="h-9">Add Supplier</Button>
  <div className="flex w-full items-center gap-3 md:max-w-2xl md:justify-end">
    {/* Search input ... */}
    <label className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-sm text-muted-foreground">
      <Checkbox />
      <span>Has price list</span>
    </label>
  </div>
</div>
```

- __Table header__
```tsx
<thead className="text-muted-foreground">
  <tr className="border-b">
    <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">Name</th>
    {/* more columns */}
  </tr>
</thead>
```

### Product Images
- Provide a neutral frame so dark products remain visible in dark mode.
- Container:
  - Light: `bg-card` with no ring (avoids visible banding/lines next to images)
  - Dark: `dark:bg-white/5 dark:ring-1 dark:ring-white/10`
- Image element: `object-contain` plus dark-mode emphasis `dark:brightness-110 dark:drop-shadow-[0_8px_24px_rgba(0,0,0,0.85)]`.
- Avoid heavy gradients in light mode; prefer flat backgrounds.

## Icons
- Use `lucide-react` icons at `h-4 w-4` inside controls.
- Place icons left of the label with `gap-2`.
- Canonical delete icon: `Trash2` (use with `Button variant="destructiveSoft" size="icon"`).

## States & Feedback
- __Loading__: Skeletons or subdued placeholders; avoid layout shift.
- __Empty state__: Short friendly message, optional action button.
- __Error__: Red text with a concise message inside a neutral card.

## Focus & Accessibility
- Always keep focus styles: `focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2` when using custom focusable elements.
- Link labels to inputs with `htmlFor`.
- Ensure interactive regions have adequate hit area (`h-9` for row controls).

## Elevation & Borders
- Cards: `rounded-xl border bg-card shadow-sm`.
- Interactive hover areas: subtle `hover:bg-muted` for rows/buttons.

## Radii & Density
- Default radius: `rounded-lg` for inputs/buttons; `rounded-xl` for containers.
- Dense controls use `h-9` height for alignment across toolbars.

## Responsive Rules
- Small screens: stack vertically using `flex-col` and `gap-3`.
- Desktop: align with `md:flex-row md:items-center md:justify-between`.
- Widths: search field `md:w-96`, group container `md:max-w-2xl`.

## Data Conventions
- Units of Measure
  - Store `unit_code` in uppercase (EA, KG, M, MM, CM, L, SQM, PR, PCS).
  - Store `unit_name` in Title Case for display (Each, Kilogram, Meter, …).
  - Both `unit_code` and `unit_name` are unique case-insensitively; duplicates like EA/ea are not allowed.
  - UI should present de-duplicated, alphabetized `unit_name` options.
  - Database normalizes inputs via trigger: `unit_code` → UPPER, `unit_name` → Title Case.
- Date & Time Formatting
  - **Locale**: South Africa (en-ZA)
  - **Date format**: `dd/MM/yyyy` (e.g., 07/10/2025)
  - **Date with time**: `dd/MM/yyyy HH:mm` (e.g., 07/10/2025 14:30)
  - **Relative times**: Use `date-fns` `formatDistanceToNow` for recent activity (e.g., "2 hours ago")
  - **Date inputs**: Use HTML5 date input (`type="date"`) which provides native picker; store as ISO 8601 (`yyyy-MM-dd`) in database
  - **Implementation**: Use `date-fns` format tokens:
    ```tsx
    import { format, parseISO } from 'date-fns';

    // Date only
    format(parseISO(isoString), 'dd/MM/yyyy')  // 07/10/2025

    // Date with time
    format(parseISO(isoString), 'dd/MM/yyyy HH:mm')  // 07/10/2025 14:30

    // Relative time for activity feeds
    formatDistanceToNow(parseISO(isoString), { addSuffix: true })  // "2 hours ago"
    ```

## Do / Avoid
- __Do__: Reuse UI primitives from `components/ui/*`.
- __Do__: Prefer `text-sm` for table UI and forms; `font-medium` for headers.
- __Do__: Keep consistent spacing increments and heights.
- __Avoid__: Inline arbitrary values unless necessary.
- __Avoid__: Creating new component styles without variants.

## Theming Extensions
- If you add new colors, extend Tailwind theme and map to CSS variables so they work in light/dark.
- Add new component variants using `cva` to keep API uniform.

## File/Folder Conventions
- Page-level layout in `components/layout/*` (`root-layout.tsx`, `navbar.tsx`, `sidebar.tsx`).
- Feature UIs live under `components/features/<feature>/`.
- Shared primitives only in `components/ui/*`.

---

This guide will evolve. When introducing a new pattern, add a short snippet here and prefer extending existing primitives/variants over introducing ad-hoc styles.
- __Nested accordions (override editor pattern)__
  - Group header: `bg-card` + `shadow-sm`, rounded corners, summary copy (`text-xs text-muted-foreground`).
  - Value rows: border with `bg-muted/20`, expand to `bg-card/80` for form sections.
  - Indicators: use `ChevronDown` with rotation transition.
  - Summary text: show quick status (“Uses base BOM row”, “Qty Δ 1 • Cutlist”) in `text-muted-foreground`.
  - Buttons inside expanded panel: right-aligned, `Button size="sm"` for Save/Clear.
  - Ensure collapse/expand states are accessible via `button` + `aria-expanded` (handled by default state toggles).
  - Component picker popovers use `bg-popover`, `z-[80]`, and a manual list (buttons) to avoid pointer-capture issues inside dialogs; input search field sits at top with icon, list entries render as full-width buttons.
