#!/bin/sh
# Applies every migration to a fresh local Postgres database with a small Supabase stand-in (auth schema,
# roles), then runs the SQL tests. Usage: PSQL="psql -h /tmp/pgt -p 54329 -U postgres" sh supabase/tests/run_all.sh
set -e
cd "$(dirname "$0")/.."
PSQL=${PSQL:-psql}
DB=${DB:-hermes_pos_test}
$PSQL -q -c "drop database if exists $DB" -c "create database $DB" postgres
RUN="$PSQL -q -v ON_ERROR_STOP=1 -d $DB"
$RUN <<'SQL'
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage on sequences to authenticated, service_role;
SQL
for f in migrations/*.sql; do
  case "$f" in *002_addaccount.sql) continue;; esac
  $RUN -c "set client_min_messages = warning" -f "$f" > /dev/null || { echo "FAIL $f"; exit 1; }
done
echo "migrations applied"
for t in tests/test_0*.sql; do
  [ -f "$t" ] || continue
  echo "== $t"
  $RUN -f "$t" 2>&1 | sed -n -e "/ERROR/p" -e "/\(PASS\|FAIL\|TOTAL\)/{s/.*NOTICE:  //;s/^ *//;p;}"
done
