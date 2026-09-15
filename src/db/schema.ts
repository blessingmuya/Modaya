import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  uuid,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_user_idx").on(t.userId)],
);

/** A media file living in object storage. role = source footage or reference video. */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("source"), // source | reference | export
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes"),
    durationSec: doublePrecision("duration_sec"),
    width: integer("width"),
    height: integer("height"),
    fps: doublePrecision("fps"),
    probe: jsonb("probe"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("media_project_idx").on(t.projectId)],
);

/** Ordered clips referencing source time ranges — the deterministic timeline model. */
export const timelines = pgTable("timelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" })
    .unique(),
  clips: jsonb("clips").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const renderJobs = pgTable(
  "render_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"), // queued|running|done|error
    spec: jsonb("spec").notNull(),
    specHash: text("spec_hash").notNull(),
    outputKey: text("output_key"),
    error: text("error"),
    log: text("log"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_status_idx").on(t.status), index("jobs_project_idx").on(t.projectId)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type RenderJob = typeof renderJobs.$inferSelect;

export const styleProfiles = pgTable(
  "style_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" })
      .unique(),
    profile: jsonb("profile").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("style_project_idx").on(t.projectId)],
);

export const editPlans = pgTable(
  "edit_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    results: jsonb("results").notNull(),
    markers: jsonb("markers").notNull().default([]),
    origin: text("origin").notNull().default("reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plans_project_idx").on(t.projectId)],
);
