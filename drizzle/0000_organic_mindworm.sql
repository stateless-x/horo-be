CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"expiresAt" timestamp,
	"password" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bazi_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"year_pillar" varchar(100) NOT NULL,
	"month_pillar" varchar(100) NOT NULL,
	"day_pillar" varchar(100) NOT NULL,
	"hour_pillar" varchar(100),
	"day_master" varchar(50) NOT NULL,
	"primary_element" varchar(50) NOT NULL,
	"element_strength" varchar(500) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bazi_charts_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
CREATE TABLE "birth_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"birth_date" timestamp NOT NULL,
	"birth_hour" integer,
	"birth_time_period" varchar(50),
	"gender" varchar(10) NOT NULL,
	"is_time_unknown" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thai_astrology_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"day" varchar(50) NOT NULL,
	"color" varchar(100) NOT NULL,
	"planet" varchar(100) NOT NULL,
	"buddha_position" varchar(200) NOT NULL,
	"personality" varchar(500) NOT NULL,
	"lucky_number" integer NOT NULL,
	"lucky_direction" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "thai_astrology_data_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
CREATE TABLE "compatibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_a_id" uuid NOT NULL,
	"profile_b_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"element_harmony" integer,
	"branch_harmony" integer,
	"analysis" text NOT NULL,
	"strengths" varchar(2000),
	"challenges" varchar(2000),
	"share_token" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "compatibility_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "daily_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"date" date NOT NULL,
	"content" text NOT NULL,
	"lucky_number" integer,
	"lucky_color" varchar(100),
	"lucky_direction" varchar(100),
	"element_energy" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compatibility_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"inviter_id" text NOT NULL,
	"inviter_name" text NOT NULL,
	"inviter_profile_id" uuid NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL,
	"used_by" text,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "compatibility_invite_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazi_charts" ADD CONSTRAINT "bazi_charts_profile_id_birth_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."birth_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birth_profiles" ADD CONSTRAINT "birth_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thai_astrology_data" ADD CONSTRAINT "thai_astrology_data_profile_id_birth_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."birth_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibility" ADD CONSTRAINT "compatibility_profile_a_id_birth_profiles_id_fk" FOREIGN KEY ("profile_a_id") REFERENCES "public"."birth_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibility" ADD CONSTRAINT "compatibility_profile_b_id_birth_profiles_id_fk" FOREIGN KEY ("profile_b_id") REFERENCES "public"."birth_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_readings" ADD CONSTRAINT "daily_readings_profile_id_birth_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."birth_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibility_invite" ADD CONSTRAINT "compatibility_invite_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibility_invite" ADD CONSTRAINT "compatibility_invite_inviter_profile_id_birth_profiles_id_fk" FOREIGN KEY ("inviter_profile_id") REFERENCES "public"."birth_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibility_invite" ADD CONSTRAINT "compatibility_invite_used_by_user_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;