CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "broadcast_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_version" text NOT NULL,
	"label" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "highlights" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"match_id" text,
	"steam_id" text NOT NULL,
	"player_name" text NOT NULL,
	"player_avatar_url" text,
	"team_id" text,
	"team_name" text,
	"side" text NOT NULL,
	"slot" text NOT NULL,
	"map_name" text NOT NULL,
	"round" integer NOT NULL,
	"score_left" integer NOT NULL,
	"score_right" integer NOT NULL,
	"kill_count" integer DEFAULT 0 NOT NULL,
	"clutch_against" integer,
	"victims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weapons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headshots" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"clip" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overlay_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"min_client_version" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overlay_releases_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"steam_id" text NOT NULL,
	"nickname" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"country" text,
	"avatar_url" text,
	"team_id" text,
	"role" text,
	"is_coach" boolean DEFAULT false NOT NULL,
	"socials" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_steamId_unique" UNIQUE("steam_id")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"metric" text NOT NULL,
	"subject_key" text NOT NULL,
	"steam_id" text,
	"player_name" text,
	"player_avatar_url" text,
	"team_id" text,
	"team_name" text,
	"value" double precision NOT NULL,
	"previous_value" double precision,
	"map_name" text,
	"match_id" text,
	"session_id" text,
	"achieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"country" text,
	"logo_url" text,
	"color" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "sessions_started_idx" ON "broadcast_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "highlights_session_idx" ON "highlights" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "highlights_steam_idx" ON "highlights" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "highlights_occurred_idx" ON "highlights" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "players_team_idx" ON "players" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "records_unique_idx" ON "records" USING btree ("scope","metric","subject_key");--> statement-breakpoint
CREATE INDEX "records_metric_idx" ON "records" USING btree ("metric");