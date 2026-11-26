import { type Kysely, sql } from 'kysely'

// *_ai_ci folds Thai tone marks (ขาว = ข้าว): compare names exactly. utf8mb4_bin exists on both MySQL and MariaDB.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE categories MODIFY name varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`.execute(db)
  await sql`ALTER TABLE habits MODIFY name varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`.execute(db)
}
