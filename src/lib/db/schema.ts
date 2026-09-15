import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
  }),
);

/**
 * Server-side sessions. The cookie carries a random token; only its SHA-256 hash
 * is stored, so a database dump cannot be replayed as a login.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashUnique: uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('projects_user_idx').on(t.userId),
  }),
);

/**
 * A media asset is always an object in the S3-compatible bucket; the row is the
 * pointer plus whatever ffprobe told us about it.
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** source = footage being edited, reference = style reference, export = render output */
    role: text('role').notNull(),
    kind: text('kind').notNull(),
    bucketKey: text('bucket_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    durationSec: text('duration_sec'),
    width: integer('width'),
    height: integer('height'),
    fps: text('fps'),
    status: text('status').notNull().default('pending'),
    probeJson: jsonb('probe_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index('media_assets_project_idx').on(t.projectId, t.role),
    keyUnique: uniqueIndex('media_assets_bucket_key_unique').on(t.bucketKey),
  }),
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
