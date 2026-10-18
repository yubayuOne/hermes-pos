import pgserver, psycopg2, glob, os, sys
# Menyiapkan Postgres lokal (tanpa Docker/Supabase) + stub auth, lalu menerapkan semua migrasi.
# pip install pgserver psycopg2-binary
srv = pgserver.get_server('/tmp/pgdata', cleanup_mode=None)
uri = srv.get_uri()
print(uri)
open('/tmp/pguri','w').write(uri)
conn = psycopg2.connect(uri); conn.autocommit=True
cur = conn.cursor()
cur.execute("drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;")
cur.execute("""
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public, auth to authenticated, anon;
""")
import os
base=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','migrations')+'/'
files = sorted(os.listdir(base))
ok=True
for f in [x for x in files if x!='002_addaccount.sql']:
    try:
        sql=open(base+f).read().replace('create extension if not exists pgcrypto;','')
        cur.execute(sql)
        print('OK  ', f)
    except Exception as e:
        print('FAIL', f, str(e).splitlines()[0]); ok=False
cur.execute("grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated; grant execute on all functions in schema public to authenticated, anon;")
print('grants done')
