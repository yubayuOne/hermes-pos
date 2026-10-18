# Uji RPC 017 terhadap logika lama klien + otorisasi. Jalankan setup_db.py dulu.
import os, psycopg2, psycopg2.extras, uuid, json, random, datetime, collections
from zoneinfo import ZoneInfo
uri=open('/tmp/pguri').read()
conn=psycopg2.connect(uri); conn.autocommit=True; cur=conn.cursor()
cur.execute(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','migrations','017_read_path_optimization.sql')).read()); print("017 applied")

def uid(): return str(uuid.uuid4())
U1,U2=uid(),uid(); C1,C2=uid(),uid(); O1=uid()
cur.execute("insert into auth.users values(%s),(%s)",(U1,U2))
cur.execute("insert into outlets(id,name) values(%s,'Outlet A')",(O1,))
cur.execute("insert into cashier_sessions(auth_user_id,cashier_id,outlet_id,cashier_name,outlet_name,terminal_name,is_active) values(%s,%s,%s,'Kasir1','Outlet A','T1',true),(%s,%s,%s,'Kasir2','Outlet A','T2',true)",(U1,C1,O1,U2,C2,O1))
prods=[]
spec=[('Nasi Goreng','kitchen',25000,900),('Mie Ayam','kitchen',20000,900),('Ayam Bakar','kitchen',30000,900),('Sate','kitchen',28000,900),('Soto','kitchen',22000,900),('Rawon','kitchen',27000,900),
      ('Kopi Susu','bar',18000,900),('Teh Tarik','bar',15000,900),('Es Jeruk','bar',12000,900)]
for n,st,pr,stock in spec:
    pid=uid(); prods.append(pid)
    cur.execute("insert into products(id,outlet_id,name,hpp,selling_price,stock,station) values(%s,%s,%s,%s,%s,%s,%s)",(pid,O1,n,pr*0.5,pr,stock,st))

def as_user(u):
    cur.execute("reset role"); cur.execute("set role authenticated"); cur.execute("select set_config('request.jwt.claim.sub',%s,false)",(u,))
def as_super():
    cur.execute("reset role")

as_user(U1)
cur.execute("select open_shift(%s,%s,100000)",(C1,O1)); SH=cur.fetchone()[0]
random.seed(7)
tx_ids=[]
for i in range(60):
    n=random.randint(1,4); picks=random.sample(prods,n)
    items=[{'product_id':p,'quantity':random.randint(1,3)} for p in picks]
    total=0
    for it in items:
        cur.execute("select selling_price from products where id=%s",(it['product_id'],)); total+=float(cur.fetchone()[0])*it['quantity']
    method=random.choice(['cash','qris'])
    cur.execute("select complete_checkout(%s,%s,%s,%s::jsonb,%s::payment_method,%s,null,%s,null,null)",(SH,C1,O1,json.dumps({'items':items,'customer_name':'','customer_phone':'','table_number':''}),method,total if method=='qris' else total+5000,f'k{i}'))
    r=cur.fetchone()[0]; tx_ids.append(r['transactionId'])
# sebar created_at ke jam 7..21 WIB
as_super()
for i,t in enumerate(tx_ids):
    h=7+(i*15//60)+ (0 if i<55 else 0)
    cur.execute("update transactions set created_at=(date_trunc('day',now() at time zone 'Asia/Jakarta') + make_interval(hours=>%s,mins=>%s)) at time zone 'Asia/Jakarta' where id=%s",(h,i%60,t))
as_user(U1)
# held bill (belum dibayar) dengan produk duplikat dalam payload + split sebagian
items=[{'product_id':prods[0],'quantity':4},{'product_id':prods[6],'quantity':2},{'product_id':prods[2],'quantity':1}]
cur.execute("select save_held_bill(%s,%s,%s,%s::jsonb)",(SH,C1,O1,json.dumps({'items':items,'customer_name':'Budi','customer_phone':'0812','table_number':'7'})))
HELD=cur.fetchone()[0]
cur.execute("select start_split_from_held(%s)",(HELD,)); 
# bayar child: 2 nasi goreng + 1 kopi
child=[{'product_id':prods[0],'quantity':2},{'product_id':prods[6],'quantity':1}]
cur.execute("select complete_checkout(%s,%s,%s,%s::jsonb,'cash'::payment_method,%s,null,'child1',%s,null)",(SH,C1,O1,json.dumps({'items':child,'customer_name':'Budi','customer_phone':'0812','table_number':'7'}),200000,HELD))
print("child checkout:",cur.fetchone()[0])

# ===== DASHBOARD: port logika lama klien =====
as_super()
cur.execute("""select t.id,t.total,t.payment_method,t.created_at,ti.quantity,ti.selling_price_unit,p.id,p.name,p.station
 from transactions t left join transaction_items ti on ti.transaction_id=t.id left join products p on p.id=ti.product_id
 where t.shift_id=%s and t.status='completed'""",(SH,))
rows=cur.fetchall()
txs={}; 
for tid,total,pm,ca,q,sp,pid,pn,st in rows:
    d=txs.setdefault(tid,dict(total=float(total),pm=pm,ca=ca,items=[]))
    if pid: d['items'].append((pid,pn,st,float(q),float(q)*float(sp)))
sales=sum(t['total'] for t in txs.values()); cash=sum(t['total'] for t in txs.values() if t['pm']=='cash'); qris=sum(t['total'] for t in txs.values() if t['pm']=='qris')
hourly=collections.defaultdict(float)
for t in txs.values(): hourly[t['ca'].astimezone(ZoneInfo('Asia/Jakarta')).hour]+=t['total']
agg={}
for t in txs.values():
    for pid,pn,st,q,sub in t['items']:
        a=agg.setdefault(pid,[pn,st,0,0]); a[2]+=q; a[3]+=sub
rank=sorted(agg.items(),key=lambda kv:(-kv[1][3],kv[1][0]))
old_kitchen=[(v[0],v[2],v[3]) for k,v in rank if v[1]=='kitchen'][:5]
old_bar=[(v[0],v[2],v[3]) for k,v in rank if v[1]=='bar'][:5]
old_best=rank[0][1][0]

as_user(U1)
cur.execute("select get_shift_dashboard(%s)",(SH,)); D=cur.fetchone()[0]
chk=[]
chk.append(('jumlah completed',D['completedCount'],len(txs)))
chk.append(('omzet',float(D['sales']),sales)); chk.append(('cash',float(D['cash']),cash)); chk.append(('qris',float(D['qris']),qris))
chk.append(('hourly',{h['hour']:float(h['total']) for h in D['hourly']},dict(hourly)))
chk.append(('top kitchen',[(x['productName'],float(x['qty']),float(x['subtotal'])) for x in D['topKitchen']],old_kitchen))
chk.append(('top bar',[(x['productName'],float(x['qty']),float(x['subtotal'])) for x in D['topBar']],old_bar))
chk.append(('best',D['best']['productName'],old_best))
for name,a,b in chk: print(('PASS' if a==b else 'FAIL'),'dashboard',name, '' if a==b else (a,b))
print('payload dashboard bytes:',len(json.dumps(D)))

# ===== ITEM BILL DITAHAN: port fetchHeldBillItems =====
as_super()
cur.execute("select product_id,quantity,hpp_unit,selling_price_unit from transaction_items where transaction_id=%s",(HELD,)); parent=cur.fetchall()
cur.execute("select ti.product_id,ti.quantity from transaction_items ti join transactions c on c.id=ti.transaction_id where c.parent_transaction_id=%s and c.status='completed'",(HELD,)); kids=cur.fetchall()
alloc=collections.defaultdict(float)
for p,q in kids: alloc[p]+=float(q)
grp={}
for p,q,h,s in parent:
    g=grp.setdefault(p,[0,float(h),float(s)]); g[0]+=float(q)
exp=[]
for p,(q,h,s) in grp.items():
    cur.execute("select name,stock,station from products where id=%s",(p,)); n,stk,st=cur.fetchone()
    rem=q-alloc[p]
    if rem>0: exp.append(dict(productId=p,name=n,unitPrice=s,hpp=h,quantity=rem,stock=max(float(stk),rem),station=st))
exp.sort(key=lambda x:(x['name'],x['productId']))
as_user(U1)
cur.execute("select get_held_bill_items(%s)",(HELD,)); got=cur.fetchone()[0]
norm=lambda L:[{k:(float(v) if isinstance(v,(int,float)) else v) for k,v in x.items()} for x in L]
print('PASS' if norm(got)==norm(exp) else 'FAIL','held items',got if norm(got)!=norm(exp) else f'({len(got)} baris sisa)')
print('  sisa:',[(x['name'],x['quantity']) for x in got])
cur.execute("select recall_held_bill_with_items(%s)",(HELD,)); R=cur.fetchone()[0]
cur.execute("select recall_held_bill(%s)",(HELD,)); R0=cur.fetchone()[0]
hdr_ok=all(R[k]==R0[k] for k in R0); print('PASS' if hdr_ok and norm(R['items'])==norm(exp) else 'FAIL','recall_with_items header+items'); print('  header:',{k:R[k] for k in R if k!='items'})

# ===== OTORISASI =====
def expect_fail(label,fn_sql,args,user):
    as_user(user) if user else (cur.execute("reset role"),cur.execute("set role authenticated"),cur.execute("select set_config('request.jwt.claim.sub','',false)"))
    try:
        cur.execute(fn_sql,args); print('FAIL',label,'(seharusnya ditolak)')
    except Exception as e: print('PASS',label,'->',str(e).splitlines()[0])
expect_fail('dashboard milik kasir lain','select get_shift_dashboard(%s)',(SH,),U2)
expect_fail('held items milik kasir lain','select get_held_bill_items(%s)',(HELD,),U2)
expect_fail('recall milik kasir lain','select recall_held_bill_with_items(%s)',(HELD,),U2)
expect_fail('dashboard tanpa login','select get_shift_dashboard(%s)',(SH,),None)
# anon tidak punya execute
cur.execute("reset role"); cur.execute("set role anon")
try: cur.execute("select get_shift_dashboard(%s)",(SH,)); print('FAIL anon boleh execute')
except Exception as e: print('PASS anon ditolak ->',str(e).splitlines()[0])
cur.execute("reset role")

# ===== SHIFT KOSONG =====
as_user(U2)
cur.execute("select open_shift(%s,%s,0)",(C2,O1)); SH2=cur.fetchone()[0]
cur.execute("select get_shift_dashboard(%s)",(SH2,)); E=cur.fetchone()[0]; print('PASS' if E['completedCount']==0 and E['hourly']==[] and E['topKitchen']==[] and E['best'] is None else 'FAIL','shift kosong',E)
