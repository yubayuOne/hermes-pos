import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

/**
 * The phone's local database (offline architecture, stage 1): the outlet's reference data from
 * pos_reference_snapshot (migration 052). Screens read from here; the server copy refreshes it. Rows keep the server's
 * JSON as it came (`data`), with the keys needed to find and order them. Later stages add their own tables as new
 * entries in MIGRATIONS; an applied entry is never edited.
 */
const MIGRATIONS = [
  `create table if not exists meta (key text primary key not null, value text not null);
   create table if not exists cashiers (cashier_id text primary key not null, outlet_id text not null, position integer not null, data text not null);
   create table if not exists products (id text primary key not null, outlet_id text not null, position integer not null, data text not null);
   create table if not exists categories (id text primary key not null, outlet_id text not null, position integer not null, data text not null);
   create table if not exists vouchers (outlet_id text not null, code text not null, position integer not null, data text not null, primary key (outlet_id, code));`,
  // 2: the open shift of each cashier (migration 053), so offline the app knows a shift is already open on the server.
  `create table if not exists open_shifts (cashier_id text primary key not null, outlet_id text not null, data text not null);`,
  // 3: this phone's terminal code per outlet and its bill counters (migration 054). Kept on sign-out: the phone stays the
  // same terminal, and a counter that started over would repeat numbers.
  `create table if not exists terminals (outlet_id text primary key not null, code text not null);
   create table if not exists counters (key text primary key not null, value integer not null);`,
  // 4: whole shifts as the server sent them (pos_shift_snapshot, migration 055): bills, items, refunds, expenses, report.
  `create table if not exists shift_snapshots (shift_id text primary key not null, outlet_id text not null, version text not null, synced_at text not null, data text not null);`,
];

let opening: Promise<SQLiteDatabase> | null = null;

export function localDb(): Promise<SQLiteDatabase> {
  if (!opening) {
    opening = (async () => {
      const db = await openDatabaseAsync('hermes-pos.db');
      const row = await db.getFirstAsync<{ user_version: number }>('pragma user_version');
      for (let v = row?.user_version ?? 0; v < MIGRATIONS.length; v++) {
        await db.withTransactionAsync(async () => {
          await db.execAsync(MIGRATIONS[v]);
          await db.execAsync(`pragma user_version = ${v + 1}`);
        });
      }
      return db;
    })().catch((e) => {
      opening = null; // try again on the next call instead of keeping a failed open
      throw e;
    });
  }
  return opening;
}
