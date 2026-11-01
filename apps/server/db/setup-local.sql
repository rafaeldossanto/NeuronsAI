-- Creates the local development role and database for NeuronsAI. Safe to run repeatedly:
-- the role and database are created only if missing, and the role password is (re)set each time.
--
-- Run as a superuser, passing the password on the command line (it is never stored in a file):
--   psql -U postgres -h 127.0.0.1 -v neurons_password=YOUR_PASSWORD -f apps/server/db/setup-local.sql

\set ON_ERROR_STOP on

\if :{?neurons_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'Missing password. Run again with: -v neurons_password=YOUR_PASSWORD'; END $$;
\endif

-- psql variables are not expanded inside DO blocks, so build the statements and run them with \gexec.
SELECT format('CREATE ROLE neurons LOGIN PASSWORD %L', :'neurons_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'neurons')
\gexec

SELECT format('ALTER ROLE neurons WITH LOGIN PASSWORD %L', :'neurons_password')
\gexec

SELECT 'CREATE DATABASE neurons_dev OWNER neurons'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'neurons_dev')
\gexec

REVOKE ALL ON DATABASE neurons_dev FROM PUBLIC;
GRANT ALL ON DATABASE neurons_dev TO neurons;
