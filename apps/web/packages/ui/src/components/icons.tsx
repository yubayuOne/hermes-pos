// The only icons (DESIGN.md A6): bell, close, hamburger, and the pencil that marks a name opening its edit dialog.
// 2px ink strokes, decorative (label on the button).
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true } as const;

export function BellIcon() {
  return (
    <svg {...base}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" strokeLinejoin="round" />
      <path d="M10 21h4" strokeLinecap="round" />
    </svg>
  );
}
export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}
export function MenuIcon() {
  return (
    <svg {...base}>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}
/** 16px by default: it sits after the text of a name that opens its edit dialog. */
export function PencilIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} className="flex-none">
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" strokeLinejoin="round" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}
