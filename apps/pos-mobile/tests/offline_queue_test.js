// Tests src/services/transaction/offlineQueue.ts. Run from apps/pos-mobile: node tests/offline_queue_test.js
const ts = require('typescript'),
  fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..');
const compile = (rel, req) => {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out)(mod, mod.exports, req);
  return mod.exports;
};
// --- fakes ---
const store = new Map();
let failSet = false,
  failGet = false;
const AsyncStorage = {
  getItem: async (k) => {
    if (failGet) throw new Error('read failed');
    return store.has(k) ? store.get(k) : null;
  },
  setItem: async (k, v) => {
    if (failSet) throw new Error('disk full');
    store.set(k, v);
  },
};
let behave = () => ({ ok: true });
const calls = [];
const checkoutArgs = [];
const updateCalls = [];
const opCalls = [];
let heldCache = [];
let serverRemaining = () => Promise.reject(new Error('Network request failed'));
const repo = {
  openShiftWithId: async (args) => {
    opCalls.push('open:' + args.shiftId);
  },
  closeShift: async (args) => {
    opCalls.push('close:' + args.shiftId + ':' + args.physicalCash);
    return {};
  },
  createTemporaryProduct: async (args) => {
    opCalls.push('product:' + args.productId);
    return { id: args.productId };
  },
  checkout: async (args) => {
    calls.push(args.idempotencyKey);
    checkoutArgs.push(args);
    const r = await behave(args);
    if (r.err) throw r.err;
    return { transactionId: 't', transactionNumber: 'N', total: 1, change: 0 };
  },
};
const holdCalls = [];
let holdBehave = () => ({ ok: true });
const held = {
  saveHeldBill: async (args) => {
    holdCalls.push(args);
    const r = await holdBehave(args);
    if (r.err) throw r.err;
    return 'h1';
  },
  fetchRemainingBillItems: () => serverRemaining(),
  updateHeldBill: async (args) => {
    updateCalls.push(args);
    const r = await holdBehave(args);
    if (r.err) throw r.err;
  },
};
const i18n = { t: (k, v) => (k.includes('|') ? k.slice(0, k.indexOf('|')) : k).replace(/\{(\w+)\}/g, (m, x) => (v && v[x] !== undefined ? String(v[x]) : m)) };
let phoneOnline = true;
const network = { isOnline: () => phoneOnline };
const discount = compile('src/utils/discount.ts', () => ({}));
const errors = compile('src/utils/errors.ts', (id) => (id.endsWith('/i18n') ? i18n : {}));
const req = (id) =>
  id.includes('async-storage')
    ? { default: AsyncStorage, __esModule: true }
    : id.endsWith('/repository')
      ? repo
      : id.endsWith('/utils/errors')
        ? errors
        : id.endsWith('/heldBills')
          ? held
          : id.endsWith('/shiftData')
            ? { readHeldBill: async (_shiftId, billId) => heldCache.find((h) => h.row.id === billId) ?? null }
            : id.endsWith('/i18n')
              ? i18n
              : id.endsWith('/network')
                ? network
                : id.endsWith('/utils/discount')
                  ? discount
                  : {};
const Q = compile('src/services/transaction/offlineQueue.ts', req);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0,
  fail = 0;
const ok = (c, m) => {
  c ? pass++ : fail++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const mk = (key, extra = {}) => ({
  idempotencyKey: key,
  shiftId: 's1',
  cashierId: 'c1',
  outletId: 'o1',
  items: [{ productId: 'p', name: 'x', unitPrice: 1000, hpp: 0, quantity: 2, stock: 9, station: 'bar' }],
  customer: { name: '', phone: '', table: '' },
  payment: { method: 'cash', amountReceived: 5000 },
  total: 2000,
  ...extra,
});
const netErr = () => ({ err: new Error('Network request failed') });
// Server error text as the database raises it (Indonesian).
const dbErr = () => ({ err: { message: 'Stok Es Teh tidak cukup' } });
const reset = () => {
  holdCalls.length = 0;
  holdBehave = () => ({ ok: true });
  store.clear();
  calls.length = 0;
  failSet = false;
  failGet = false;
  behave = () => ({ ok: true });
  Q.__resetForTests();
};
(async () => {
  // 1 save + dedupe + survives restart
  reset();
  await Q.enqueueCheckout(mk('k1'));
  await Q.enqueueCheckout(mk('k1'));
  ok(Q.getQueueSnapshot().length === 1, 'the same key is not queued twice');
  Q.__resetForTests();
  await Q.loadQueue();
  ok(Q.getQueueSnapshot().length === 1 && Q.getQueueSnapshot()[0].status === 'waiting', 'queue survives an app restart');
  ok(Q.hasQueuedForShift('s1') && !Q.hasQueuedForShift('s2'), 'hasQueuedForShift per shift');
  // 2 success
  reset();
  await Q.enqueueCheckout(mk('a'));
  let r = await Q.syncCheckoutQueue();
  ok(r.synced === 1 && r.remaining === 0 && calls[0] === 'a', 'success: removed from the queue, same idempotency key used');
  ok(JSON.parse(store.get(Q.QUEUE_KEY)).length === 0, 'storage emptied too');
  // 3 network down: stop, keep waiting
  reset();
  await Q.enqueueCheckout(mk('a'));
  await Q.enqueueCheckout(mk('b'));
  behave = netErr;
  r = await Q.syncCheckoutQueue();
  ok(r.offline && r.synced === 0 && r.remaining === 2 && calls.length === 1, 'network down: stops at the first entry, all keep waiting');
  ok(Q.getQueueSnapshot()[0].attempts === 1 && Q.getQueueSnapshot()[0].status === 'waiting', 'attempt recorded, status stays waiting');
  behave = () => ({ ok: true });
  r = await Q.syncCheckoutQueue();
  ok(r.synced === 2 && r.remaining === 0 && calls.join() === 'a,a,b', 'internet back: oldest first, key unchanged');
  // 4 refused by the server: conflict, not dropped, continue with the next entry
  reset();
  await Q.enqueueCheckout(mk('a'));
  await Q.enqueueCheckout(mk('b'));
  behave = (a) => (a.idempotencyKey === 'a' ? dbErr() : { ok: true });
  r = await Q.syncCheckoutQueue();
  const s = Q.getQueueSnapshot();
  ok(
    r.conflicts === 1 && r.synced === 1 && s.length === 1 && s[0].id === 'a' && s[0].status === 'conflict' && /Stok/.test(s[0].lastError),
    'refused by the server: becomes a conflict (not dropped), other entries still sent',
  );
  r = await Q.syncCheckoutQueue();
  ok(r.synced === 0 && calls.filter((c) => c === 'a').length === 1, 'conflicts are not resent automatically');
  await Q.retryQueued('a');
  ok(Q.getQueueSnapshot()[0].status === 'waiting' && !Q.getQueueSnapshot()[0].lastError, 'retryQueued moves back to waiting');
  behave = () => ({ ok: true });
  r = await Q.syncCheckoutQueue();
  ok(r.synced === 1 && r.remaining === 0, 'sent once fixed');
  await Q.enqueueCheckout(mk('z'));
  await Q.removeQueued('z');
  ok(Q.getQueueSnapshot().length === 0, 'removeQueued removes the entry');
  // 5 cashier filter
  reset();
  await Q.enqueueCheckout(mk('mine'));
  await Q.enqueueCheckout(mk('other', { cashierId: 'c2' }));
  r = await Q.syncCheckoutQueue({ cashierId: 'c1', outletId: 'o1' });
  ok(r.synced === 1 && Q.getQueueSnapshot().length === 1 && Q.getQueueSnapshot()[0].id === 'other', 'only entries of the signed-in cashier/outlet');
  // 6 concurrent syncs = one run
  reset();
  await Q.enqueueCheckout(mk('a'));
  behave = async () => {
    await sleep(30);
    return { ok: true };
  };
  const [x, y] = await Promise.all([Q.syncCheckoutQueue(), Q.syncCheckoutQueue()]);
  ok(calls.length === 1 && x.synced === 1 && y.shared === true, 'two concurrent triggers send only once');
  // 7 save fails -> throws, nothing in memory
  reset();
  failSet = true;
  let threw = false;
  try {
    await Q.enqueueCheckout(mk('a'));
  } catch {
    threw = true;
  }
  ok(threw && Q.getQueueSnapshot().length === 0, 'save failed: throws and the queue is unchanged');
  // 8 parallel enqueues do not overwrite each other
  reset();
  await Promise.all([1, 2, 3, 4, 5].map((i) => Q.enqueueCheckout(mk('k' + i))));
  ok(Q.getQueueSnapshot().length === 5 && JSON.parse(store.get(Q.QUEUE_KEY)).length === 5, '5 parallel enqueues: all stored');
  // 9 timeout counts as unknown outcome
  reset();
  behave = () => new Promise(() => {});
  let te;
  try {
    await Q.submitCheckout(mk('t'), 30);
  } catch (e) {
    te = e;
  }
  ok(te && errors.isUnknownCheckoutOutcome(te), 'hanging request -> timeout -> unknown outcome');
  // 10 error classification
  ok(
    errors.isUnknownCheckoutOutcome(new Error('Network request failed')) && !errors.isUnknownCheckoutOutcome({ message: 'Stok Es Teh tidak cukup' }),
    'network error vs server error told apart',
  );
  // 11 local stock reduced by queued sales
  reset();
  const cat = [
    { id: 'p', stock: 5 },
    { id: 'q', stock: 3 },
  ];
  ok(Q.applyQueuedStock(cat) === cat, 'empty queue: catalog unchanged');
  await Q.enqueueCheckout(mk('a'));
  await Q.enqueueCheckout(mk('b'));
  let adj = Q.applyQueuedStock(cat);
  ok(adj[0].stock === 1 && adj[1].stock === 3 && cat[0].stock === 5, 'stock of p reduced by 2+2 (not negative), original data untouched');
  await Q.enqueueCheckout(mk('c'));
  ok(Q.applyQueuedStock(cat)[0].stock === 0, 'stock never below 0');
  behave = dbErr;
  await Q.syncCheckoutQueue();
  ok(Q.applyQueuedStock(cat)[0].stock === 5, 'conflict entries do not reduce stock');
  // 12 offline held bill
  reset();
  const cat2 = [{ id: 'p', stock: 5 }];
  await Q.enqueueCheckout(
    mk('hold:1', { kind: 'hold', payment: { method: 'cash', amountReceived: 0 }, total: 0, billDiscount: { type: 'percent', value: 10 } }),
  );
  ok(Q.applyQueuedStock(cat2)[0].stock === 5, 'a queued held bill does not reduce local stock');
  holdBehave = netErr;
  r = await Q.syncCheckoutQueue();
  ok(r.offline && r.remaining === 1 && calls.length === 0 && holdCalls.length === 1, 'hold: network down -> keeps waiting, checkout not called');
  holdBehave = () => ({ ok: true });
  r = await Q.syncCheckoutQueue();
  ok(
    r.synced === 1 && r.remaining === 0 && holdCalls[1].idempotencyKey === 'hold:1' && holdCalls[1].billDiscount.value === 10,
    'hold: sent via saveHeldBill with the same key and discount',
  );
  ok(Q.hasQueuedForShift('s1') === false, 'queue empty after the hold is sent');
  reset();
  await Q.enqueueCheckout(mk('hold:2', { kind: 'hold' }));
  holdBehave = () => ({ err: { message: 'Shift aktif tidak ditemukan' } });
  r = await Q.syncCheckoutQueue();
  ok(
    r.conflicts === 1 && Q.getQueueSnapshot()[0].status === 'conflict' && Q.hasQueuedForShift('s1'),
    'hold refused by the server: becomes a conflict and still blocks closing the shift',
  );
  // 13 expired token = temporary, not a conflict
  reset();
  await Q.enqueueCheckout(mk('j'));
  behave = () => ({ err: { code: 'PGRST301', message: 'JWT expired' } });
  r = await Q.syncCheckoutQueue();
  ok(r.offline && Q.getQueueSnapshot()[0].status === 'waiting', 'JWT expired: stays waiting, not a conflict');
  ok(
    !errors.isUnknownCheckoutOutcome({ code: 'P0001', message: 'Gagal fetch connection abort' }),
    'server errors with a database code are not matched against network words',
  );
  // 14 failing to read storage does not overwrite the old queue
  reset();
  await Q.enqueueCheckout(mk('old'));
  Q.__resetForTests();
  failGet = true;
  let t14 = false;
  try {
    await Q.enqueueCheckout(mk('new'));
  } catch {
    t14 = true;
  }
  failGet = false;
  Q.__resetForTests();
  await Q.loadQueue();
  ok(t14 && Q.getQueueSnapshot().length === 1 && Q.getQueueSnapshot()[0].id === 'old', 'read failed: enqueue throws, old sales not overwritten');
  // 15 corrupt JSON is copied first
  reset();
  store.set(Q.QUEUE_KEY, '{corrupt');
  await Q.loadQueue();
  ok(Q.getQueueSnapshot().length === 0 && store.get(Q.QUEUE_KEY + ':corrupt') === '{corrupt', 'corrupt JSON: raw copy saved');
  // 16 an expense entry left on the device by an older version is kept aside and never sent (077)
  reset();
  const leftover = { id: 'x', kind: 'expense', idempotencyKey: 'expense:1', shiftId: 's1', status: 'waiting' };
  store.set(Q.QUEUE_KEY, JSON.stringify([leftover]));
  await Q.loadQueue();
  ok(
    Q.getQueueSnapshot().length === 0 && !Q.hasQueuedForShift('s1') && JSON.parse(store.get(Q.QUEUE_KEY + ':expense'))[0].id === 'x',
    'old expense entry: off the queue, copy kept, closing the shift not blocked',
  );
  // 17 recalled held bill offline: its changes, then its payment, in order, against the same bill
  reset();
  checkoutArgs.length = 0;
  updateCalls.length = 0;
  await Q.enqueueCheckout(mk('update:1', { kind: 'update', existingTransactionId: 'h9', payment: { method: 'cash', amountReceived: 0 } }));
  await Q.enqueueCheckout(mk('pay:1', { existingTransactionId: 'h9' }));
  ok(Q.applyQueuedStock([{ id: 'p', stock: 9 }])[0].stock === 7, 'held-bill change does not touch stock, its payment does');
  r = await Q.syncCheckoutQueue();
  ok(
    r.synced === 2 &&
      updateCalls.length === 1 &&
      updateCalls[0].transactionId === 'h9' &&
      calls.join() === 'pay:1' &&
      checkoutArgs[0].existingTransactionId === 'h9',
    'change sent through updateHeldBill first, then the payment of the same held bill',
  );
  await Q.enqueueCheckout(mk('pay:2'));
  await Q.syncCheckoutQueue();
  ok(checkoutArgs[1].existingTransactionId === null, 'a plain payment still sends no held bill');
  await Q.enqueueCheckout(mk('update:2', { kind: 'update', existingTransactionId: 'h8' }));
  holdBehave = () => ({ err: { message: 'Bill ditahan tidak ditemukan' } });
  r = await Q.syncCheckoutQueue();
  ok(r.conflicts === 1 && Q.getQueueSnapshot()[0].status === 'conflict', 'change refused (bill paid or deleted elsewhere): conflict, kept');
  // 18 a whole offline shift (050): open, temporary item, sale, close, next shift, sent in that order
  reset();
  opCalls.length = 0;
  const none = { items: [], payment: { method: 'cash', amountReceived: 0 }, total: 0 };
  await Q.enqueueCheckout(mk('open:A', { ...none, kind: 'open_shift', shiftId: 'A', shiftOpen: { openingCash: 100000, openedAt: '2026-10-16T01:00:00Z' } }));
  await Q.enqueueCheckout(mk('product:P', { ...none, kind: 'temp_product', shiftId: 'A', product: { id: 'P', name: 'Es', price: 5000, station: 'bar' } }));
  await Q.enqueueCheckout(mk('sale:A', { shiftId: 'A' }));
  await Q.enqueueCheckout(
    mk('close:A', { ...none, kind: 'close_shift', shiftId: 'A', shiftClose: { physicalCash: 102000, closedAt: '2026-10-16T09:00:00Z' } }),
  );
  await Q.enqueueCheckout(mk('open:B', { ...none, kind: 'open_shift', shiftId: 'B', shiftOpen: { openingCash: 0, openedAt: '2026-10-16T09:05:00Z' } }));
  ok(Q.applyQueuedStock([{ id: 'p', stock: 9 }])[0].stock === 7, 'shift and menu entries do not touch stock, the sale does');
  behave = netErr;
  r = await Q.syncCheckoutQueue();
  ok(r.offline && opCalls.join() === 'open:A,product:P' && Q.getQueueSnapshot().length === 3, 'network drops at the sale: close and next shift keep waiting');
  behave = dbErr;
  r = await Q.syncCheckoutQueue();
  ok(
    r.conflicts === 1 && Q.getQueueSnapshot().length === 3 && !opCalls.some((c) => c.startsWith('close')),
    'sale refused: the close waits behind it, the next shift is not opened',
  );
  await Q.retryQueued('sale:A');
  behave = () => ({ ok: true });
  r = await Q.syncCheckoutQueue();
  ok(
    r.synced === 3 && r.remaining === 0 && opCalls.slice(2).join() === 'close:A:102000,open:B',
    'sale sent, then the close with the counted cash, then the next shift',
  );
  // 19 offline holds: recalled only when they never left the phone, so the server never gets a second copy
  reset();
  await Q.enqueueCheckout(mk('hold:offline', { kind: 'hold' }));
  phoneOnline = false;
  holdBehave = netErr;
  await Q.syncCheckoutQueue();
  ok(!Q.getQueueSnapshot()[0].maybeSent, 'H1 sync while offline: the hold never left, not maybeSent');
  const back = await Q.takeBackHold('hold:offline');
  ok(back && back.id === 'hold:offline' && Q.getQueueSnapshot().length === 0, 'H2 a hold that never left is taken back off the queue');
  phoneOnline = true;
  await Q.enqueueCheckout(mk('hold:timeout', { kind: 'hold' }));
  await Q.syncCheckoutQueue();
  ok(Q.getQueueSnapshot()[0].maybeSent === true, 'H3 sent while online without an answer: maybeSent');
  ok((await Q.takeBackHold('hold:timeout')) === null && Q.getQueueSnapshot().length === 1, 'H4 a hold that may be on the server is not taken back');
  ok((await Q.takeBackHold('missing')) === null, 'H5 unknown id: nothing taken back');
  holdBehave = () => ({ ok: true });
  await Q.syncCheckoutQueue();
  ok(Q.getQueueSnapshot().length === 0, 'H6 the maybe-sent hold is sent with its key once online');
  await Q.enqueueCheckout(mk('sale:x'));
  await Q.enqueueCheckout(mk('hold:busy', { kind: 'hold' }));
  behave = async () => {
    await sleep(30);
    return { ok: true };
  };
  const syncing = Q.syncCheckoutQueue();
  await sleep(5);
  ok((await Q.takeBackHold('hold:busy')) === null, 'H7 not taken back while a sync runs');
  await syncing;
  // 20 split bill offline: what is left = the server's last count minus the parts still in the queue
  reset();
  const line = (productId, quantity, remainingDiscount) => ({
    productId,
    name: productId,
    unitPrice: 10000,
    hpp: 0,
    quantity,
    stock: 9,
    station: 'bar',
    remainingDiscount,
  });
  heldCache = [{ row: { id: 'H' }, header: {}, items: [], remaining: [line('kopi', 3, 3000), line('teh', 1, 0)] }];
  serverRemaining = () => Promise.reject(new Error('Network request failed'));
  let left = await Q.remainingForSplit('s1', 'H');
  ok(left.length === 2 && left[0].quantity === 3 && left[0].remainingDiscount === 3000, 'S1 offline, no parts yet: the server count kept on the device');
  const part = (key, lines) =>
    mk(key, { parentTransactionId: 'H', items: lines.map(([p, q, d]) => ({ ...line(p, q), discount: d ? { type: 'amount', value: d } : null })) });
  await Q.enqueueCheckout(part('part:1', [['kopi', 1, 1000]]));
  left = await Q.remainingForSplit('s1', 'H');
  ok(
    left.find((i) => i.productId === 'kopi').quantity === 2 && left.find((i) => i.productId === 'kopi').remainingDiscount === 2000,
    'S2 a queued part takes its portions and its discount',
  );
  serverRemaining = async () => [line('kopi', 3, 3000)];
  left = await Q.remainingForSplit('s1', 'H');
  ok(left.find((i) => i.productId === 'kopi').quantity === 2, 'S3 online but a part still queued: the server does not know it yet, the device count is used');
  await Q.enqueueCheckout(
    part('part:2', [
      ['kopi', 2, 2000],
      ['teh', 1, 0],
    ]),
  );
  ok((await Q.remainingForSplit('s1', 'H')).length === 0, 'S4 all parts queued: nothing left');
  await Q.markParentClosed('H');
  const parts = Q.getQueueSnapshot();
  ok(
    !parts[0].closesParent && parts[1].closesParent && Q.settlesHeldBill(parts[1]) === 'H' && Q.settlesHeldBill(parts[0]) === null,
    'S5 the last part settles the held bill',
  );
  heldCache = [];
  ok((await Q.remainingForSplit('s1', 'H')) === null, 'S6 no device count (changed offline or never loaded): null, split needs internet');
  reset();
  serverRemaining = async () => [line('kopi', 1, 0)];
  ok((await Q.remainingForSplit('s1', 'H')).length === 1, 'S7 online, nothing queued: the server count');
  await Q.enqueueCheckout(part('part:3', [['kopi', 1, 0]]));
  behave = () => ({ ok: true });
  await Q.syncCheckoutQueue();
  ok(checkoutArgs[checkoutArgs.length - 1].parentTransactionId === 'H', 'S8 a queued part is sent with its held bill as parent');
  // 21 stage 2 (054): a bill held offline has its final id and number, can be paid or split before it is sent
  reset();
  checkoutArgs.length = 0;
  holdCalls.length = 0;
  heldCache = [];
  const hold = mk('hold:T', {
    kind: 'hold',
    transactionId: 'T',
    number: '#HPOS-20261017-A3-0007',
    items: [{ ...line('kopi', 2), discount: { type: 'percent', value: 10 } }, line('teh', 1)],
  });
  await Q.enqueueCheckout(hold);
  ok(
    Q.entryNumber(Q.getQueueSnapshot()[0]) === '#HPOS-20261017-A3-0007' && Q.entryNumber(mk('old')) === Q.provisionalNumber('old'),
    'D1 the final number shows at once; older entries keep TUNDA',
  );
  ok(Q.billWaits('T') && !Q.billWaits('X'), 'D2 the held bill has something queued');
  let te2;
  await Q.submitCheckout(mk('pay:T', { existingTransactionId: 'T' })).catch((e) => (te2 = e));
  ok(te2 && errors.isUnknownCheckoutOutcome(te2) && calls.length === 0, 'D3 paying it while its hold waits: queued behind, never sent first');
  serverRemaining = async () => {
    throw { code: 'P0001', message: 'Bill tidak ditemukan' };
  };
  left = await Q.remainingForSplit('s1', 'T');
  ok(
    left.length === 2 && left[0].remainingDiscount === 2000 && left[1].remainingDiscount === 0,
    'D4 split of a bill held offline: its own lines and item discounts (10% of 20.000)',
  );
  await Q.enqueueCheckout(mk('part:T1', { parentTransactionId: 'T', items: [{ ...line('kopi', 1), discount: { type: 'amount', value: 1000 } }] }));
  left = await Q.remainingForSplit('s1', 'T');
  ok(
    left.find((i) => i.productId === 'kopi').quantity === 1 && left.find((i) => i.productId === 'kopi').remainingDiscount === 1000,
    'D5 a queued part comes off it',
  );
  await Q.enqueueCheckout(mk('update:T', { kind: 'update', existingTransactionId: 'T', billDiscount: { type: 'percent', value: 5 } }));
  ok((await Q.remainingForSplit('s1', 'T')) === null, 'D6 with a bill discount the split waits for the server count');
  behave = () => ({ ok: true });
  holdBehave = () => ({ ok: true });
  await Q.syncCheckoutQueue();
  ok(
    holdCalls[0].transactionId === 'T' && holdCalls[0].number === '#HPOS-20261017-A3-0007' && checkoutArgs[0].parentTransactionId === 'T',
    'D7 sent in order: the hold with its own id and number, then the part',
  );
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
