# Phase 3: Design system

**Design read:** a trust-first B2B SaaS for Bangladeshi business owners and developers, in a
calm, precise product language. Motion is restrained and density is medium. The product UI itself
is the hero visual; there is no stock photography.

All tokens are CSS variables in `src/app/globals.css`, exposed to Tailwind v4 through
`@theme inline`. Rebranding means changing the variables, not the components.

## Colour

> **Light theme only.** The dark theme and theme toggle were removed (October 2026); the app always
> renders the light tokens (`color-scheme: light`). The "Dark" columns below are kept for reference only.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#FFFFFF` | `#0A0F1E` | Page |
| `--surface` | `#F6F8FB` | `#0F162A` | Section bands, sidebar |
| `--card` | `#FFFFFF` | `#121A31` | Cards, popovers |
| `--foreground` | `#0E1A36` | `#E7ECF6` | Primary text (dark navy) |
| `--muted-foreground` | `#52607A` | `#95A2BE` | Secondary text (AA on both surfaces) |
| `--border` | `#E2E7EF` | `#223055` | Hairlines, inputs |
| `--primary` | `#1E3FA8` | `#7892FF` | Deep blue: primary actions, links, focus |
| `--primary-foreground` | `#FFFFFF` | `#0A0F1E` | Text on primary |
| `--accent` | `#0B8A83` | `#2CC7B8` | Teal: highlights, charts, "live" data |
| `--success` | `#15803D` | `#4ADE80` | Delivered, paid |
| `--warning` | `#B45309` | `#FBBF24` | Pending, low balance |
| `--destructive` | `#C0262D` | `#F87171` | Failed, destructive actions |
| `--ring` | `#1E3FA8` | `#7892FF` | Focus ring |

Rules: one brand accent (teal) and one action colour (blue). Status colours only carry status.
Gradients are limited to one very soft background wash in the hero. Shadows are tinted navy,
never black.

Chart palette. It was checked with a palette validator for lightness band, chroma, colour-vision-deficiency
separation between adjacent pairs, and contrast against each theme's card surface. Categorical series take
the hues in this fixed order and never cycle them. A sixth series folds into "Other".

| Token | Light | Dark | Hue |
|---|---|---|---|
| `--chart-1` | `#2F55C8` | `#5A79EC` | Blue |
| `--chart-2` | `#0A968A` | `#18A093` | Teal |
| `--chart-3` | `#D97706` | `#C98500` | Amber |
| `--chart-4` | `#C2415D` | `#D55181` | Rose |
| `--chart-5` | `#8A63D8` | `#8E6FE0` | Violet |

Message-status charts use reserved status colours, never the categorical ones. They always show
a label and an icon, so colour is never the only cue.

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--viz-delivered` | `#16A061` | `#2AA86C` | Delivered |
| `--viz-pending` | `#2F55C8` | `#5A79EC` | Queued / submitted |
| `--viz-failed` | `#D4413B` | `#E0574F` | Failed / rejected / expired |

Chart marks follow the rules below:
- lines are 2px
- bars have 4px rounded data-ends and a 2px surface gap between them
- the grid is recessive
- every series has a legend, and at most four series are also labelled directly
- line and area charts have a crosshair tooltip
- every chart has a screen-reader table.

## Typography

| Role | Font | Notes |
| --- | --- | --- |
| UI and marketing | **Geist Sans** (`next/font`) | Neutral and precise, with good numerals |
| Bangla | **Hind Siliguri** (`next/font`, Bengali subset) | Chained after Geist, so Bangla glyphs render correctly |
| Code, API keys, numbers in tables | **Geist Mono** | `tabular-nums` for metrics |

Scale (rem): 0.75 / 0.8125 / 0.875 (dashboard body) / 1 (marketing body) / 1.125 / 1.25 / 1.5 /
1.875 / 2.25 / 3 / 3.75. Headings use `tracking-tight`; display sizes use `-0.025em`. Body line
height is 1.6, with a 65ch max measure for prose.

## Spacing and layout

- 4px base (Tailwind scale). Marketing sections: `py-20 md:py-28`. Dashboard page padding:
  `p-4 md:p-6 lg:p-8`.
- Container: `max-w-7xl` with `px-4 sm:px-6 lg:px-8` (16px mobile gutter).
- Docs: 260px sidebar, 72ch content, right-hand "on this page" rail at `xl`.
- Dashboard: 256px sidebar at `lg+`, off-canvas sheet below `lg`.

## Shape

One documented rule, applied everywhere:

- Controls (buttons, inputs, selects, tabs): `radius-md` = **8px**
- Cards, dialogs, tables, code blocks: `radius-lg` = **12px**
- Badges, status pills, avatars: **full**

## Elevation

| Token | Value | Use |
| --- | --- | --- |
| `--shadow-xs` | `0 1px 2px rgb(14 26 54 / .05)` | Inputs, buttons |
| `--shadow-sm` | `0 1px 3px rgb(14 26 54 / .06), 0 1px 2px rgb(14 26 54 / .04)` | Cards |
| `--shadow-md` | `0 8px 24px -8px rgb(14 26 54 / .14)` | Popovers, dropdowns |
| `--shadow-lg` | `0 24px 48px -12px rgb(14 26 54 / .18)` | Dialogs, hero preview |


## Motion

- 150ms for colour and opacity; 200ms `cubic-bezier(0.16,1,0.3,1)` for transforms (menus, sheets).
- Buttons press to `translate-y-px`. Skeletons shimmer only when `prefers-reduced-motion:
  no-preference`.
- There are no scroll-jacking, parallax or infinite decorative loops.
- `prefers-reduced-motion: reduce` disables all transitions and animations globally.

## Z-index scale

`header 40` · `dropdown 50` · `overlay 60` · `modal 70` · `toast 80` (see `src/config/ui.ts`).

## Breakpoints

Tailwind defaults: `sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`. Data tables switch to
stacked cards below `md`. The dashboard sidebar collapses into a sheet below `lg`.

## Components

Primitives in `src/components/ui` follow the shadcn/ui open-code approach (Radix under the
hood for Dialog, DropdownMenu, Select, Tabs, Popover, Tooltip, Checkbox, Switch) but are restyled
with the tokens above:

Button · Card · Badge · StatusBadge · Input · Textarea · Select · NativeSelect · Checkbox ·
Switch · Label · FormField · DatePicker (native, accessible) · Dialog · ConfirmDialog · Sheet ·
DropdownMenu · Tabs · Tooltip · Popover · Table · DataTable (responsive: table on desktop, cards
on mobile) · Pagination · Alert · Toast (Sonner) · Skeleton · Progress · Avatar · Separator ·
EmptyState · LoadingState · ErrorState · PermissionDenied · CopyButton · ApiCodeBlock.

## Accessibility baseline

- Text contrast is at least 4.5:1 (all token pairs above were chosen to meet AA).
- A visible 2px focus ring with offset on every interactive element, including a skip-to-content
  link.
- Labels sit above inputs; errors sit below them, linked with `aria-describedby`, and use
  `aria-invalid`.
- Required fields are marked visually and with `aria-required`.
- Icons are `aria-hidden`; icon-only buttons have `aria-label`.
- Tables have captions (visually hidden where redundant) and `scope` on headers.
- Charts come with a text summary or data table alternative.

## Copy rules

No superlatives ("best", "cheapest", "guaranteed"), no invented numbers, no fabricated customers.
Anything provider-dependent (delivery speed, operator coverage, masking approval) is phrased as
"depends on your configured provider or operator approval".
