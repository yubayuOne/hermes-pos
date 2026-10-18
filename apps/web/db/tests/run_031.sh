#!/bin/sh
# Runs migration 031 and its tests on a fresh database. Usage: PSQL="psql -h ... -U postgres" sh run_031.sh
set -e
cd "$(dirname "$0")"
PSQL=${PSQL:-psql}
$PSQL -q -c "drop database if exists hermes_pos_031" -c "create database hermes_pos_031" postgres
DB="$PSQL -q -v ON_ERROR_STOP=1 -d hermes_pos_031"
$DB -f stub_before_031.sql
$DB -c "set client_min_messages = warning" -f ../migrations/031_web_backoffice.sql
$DB -f test_031.sql 2>&1 | sed -n 's/.*NOTICE:  //p'
