# HERMES POS UI/UX System

## Design direction
HERMES POS uses a calm, cozy POS visual language: warm off-white surfaces, dark coffee-brown hierarchy, and a restrained orange accent. Semantic colors are reserved for success, warning, error, and information states.

## Core tokens
- Button: 48 px minimum height
- Compact control: 40 px
- Input: 46 px
- Icon button: 40 × 40 px
- Standard radius: 12 px
- Large sheet/card radius: 16–20 px
- Standard content spacing: 12 / 16 / 24 px
- Product grid gap: 10 px

## Color rules
1. Primary actions use `primaryContainer`.
2. Secondary actions use white/surface + border.
3. Destructive actions use the semantic error color; do not use arbitrary red values.
4. Success, warning, and error backgrounds are soft tints, not saturated fills.
5. Avoid introducing new colors at screen level; add a semantic token when a new state is genuinely required.

## Typography
- Body text should generally be 14 px or larger.
- Labels may use 12 px.
- Supporting metadata should stay around 11–12 px.
- Avoid excessive 8–10 px text for content users must read.
- Headings use bold/extrabold with clear hierarchy.

## Responsive cashier grid
- Phone: 2 columns.
- Tablet portrait: 3 columns.
- Tablet / wide landscape: 4 columns.
- Grid spacing remains 10 px and cards expand to fill available width.

## Interaction rules
- Every tappable control has a visible pressed state.
- Primary actions remain visually dominant.
- Destructive actions require stronger confirmation when they can cause data loss.
- Loading states replace action labels/spinners rather than allowing duplicate submissions.
- Empty, error, recovery, and success states use distinct semantic messaging.
- Bottom sheets reserve a stable footer for primary actions when the action should remain reachable while scrolling.

## Payment flow
Cart → review customer/table → choose payment method → enter/confirm amount → review receipt → confirm & print → success/recovery state.

The payment implementation already uses an idempotent payment intent and pending checkout recovery; UI changes preserve that behavior.
