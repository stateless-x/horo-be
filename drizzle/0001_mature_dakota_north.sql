CREATE INDEX "account_user_id_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "account_provider_idx" ON "account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "bazi_charts_profile_id_idx" ON "bazi_charts" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "birth_profiles_user_id_idx" ON "birth_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "thai_astrology_profile_id_idx" ON "thai_astrology_data" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "compatibility_profile_a_idx" ON "compatibility" USING btree ("profile_a_id");--> statement-breakpoint
CREATE INDEX "compatibility_profile_b_idx" ON "compatibility" USING btree ("profile_b_id");--> statement-breakpoint
CREATE INDEX "compatibility_share_token_idx" ON "compatibility" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "daily_readings_profile_date_idx" ON "daily_readings" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "compatibility_invite_token_idx" ON "compatibility_invite" USING btree ("token");--> statement-breakpoint
CREATE INDEX "compatibility_invite_inviter_idx" ON "compatibility_invite" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "compatibility_invite_expires_at_idx" ON "compatibility_invite" USING btree ("expires_at");