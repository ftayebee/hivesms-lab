# Archived PostgreSQL migrations

The application ran on PostgreSQL until the move to MySQL/MariaDB (see
`docs/06-mysql-migration-audit.md`). Prisma migration history is provider-specific, so these
files cannot be applied to MySQL. They are kept for reference only and are **not** read by
Prisma (`prisma.config.ts` points at `prisma/migrations`).

The MySQL schema starts from `prisma/migrations/20260930000000_init_mysql`.
