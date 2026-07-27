# Temporal server for Railway / Docker.
# Needs its OWN Postgres (or a separate database on the same host) — not the jobs DB schema.
#
# Railway: deploy this as a private service, wire DB_* from a dedicated Postgres
# (or create database `temporal` on your jobs Postgres and point here).
#
# Build: docker build -f infra/temporal/Dockerfile -t founderforge-temporal .
FROM temporalio/auto-setup:1.25.2

# auto-setup reads:
#   DB=postgres12
#   DB_PORT=5432
#   POSTGRES_USER / POSTGRES_PWD / POSTGRES_SEEDS
# Optional: POSTGRES_DB (defaults managed by auto-setup)
EXPOSE 7233
