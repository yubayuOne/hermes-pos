/** Per-item note (e.g. "tanpa es"). Max matches the database limit (column transaction_items.note). */
export const NOTE_MAX = 200;

export const cleanNote = (note?: string | null) => (note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);

/** RPC payload: sent only when the note is not empty. */
export function notePayload(note?: string | null) {
  const n = cleanNote(note);
  return n ? { note: n } : {};
}
