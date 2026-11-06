// The icons (DESIGN.md A6): bell, close, hamburger, and the list actions pencil (edit), trash (delete), and plus (add).
// Thin, round-capped strokes on a 24 grid, decorative (the label on the button says what they do).
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export function BellIcon() {
  return (
    <svg {...base}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" />
      <path d="M10 21h4" />
    </svg>
  );
}
export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
export function MenuIcon() {
  return (
    <svg {...base}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
/** 16px by default: it sits after the text of a name that opens its edit dialog. */
export function PencilIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} className="flex-none">
      <path d="M4 20l1-4.2L15.6 5.2a2.1 2.1 0 0 1 3 0l.2.2a2.1 2.1 0 0 1 0 3L8.2 19 4 20Z" />
      <path d="M13.8 7l3.2 3.2" />
    </svg>
  );
}
export function PlusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} className="flex-none">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
export function TrashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} className="flex-none">
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}
