# Framezoo admin design system

Locked system for the internal admin workspace. Keep operator actions dense,
clear, and quiet. No decorative gradients, glass cards, or invented metrics.

## Genre

atmospheric workbench · technical · designed-as-app

## App structure

- App pages: Workbench with a sticky command header and one active operational surface.
- Navigation: N13 inline command tabs with one active state.
- Closing pattern: Ft2 restrained workspace; no marketing footer.

## Theme

Warm-dark Framezoo palette. Paper `var(--color-paper)`, surfaces
`var(--color-paper-2)` / `var(--color-paper-3)`, ink `var(--color-ink)`,
muted ink `var(--color-ink-2)`, rule `var(--color-rule)`, accent
`var(--color-accent)` with warm highlight `var(--color-accent-warm)`.

All values live in `tokens.css`. UI CSS references named tokens only.

## Typography

- Display: `var(--font-display)`, roman, tight tracking.
- Body: `var(--font-body)`, 45–75 character measure.
- Data: `var(--font-mono)` with tabular-friendly alignment.

## Motion and states

Transform/opacity only. Focus rings are immediate. Destructive actions require
explicit confirmation. Reduced motion collapses spatial motion to opacity.

## Security UI contract

- Admin credentials stay in an HTTP-only, same-origin cookie.
- No token in `localStorage`, JavaScript-readable state, query strings, or logs.
- API calls go through `src/lib/api.ts`; endpoint strings stay out of UI components.
- List surfaces use the shared `Pagination` component and server pagination metadata.
- Backup downloads use an authenticated Blob request and revoke the object URL.
