CREATE TABLE "role_game_material_categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"role_game_id" bigint NOT NULL,
	"parent_category_id" bigint,
	"name" varchar(120) NOT NULL,
	"created_by_telegram_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_game_materials" ADD COLUMN "category_id" bigint;--> statement-breakpoint
ALTER TABLE "role_game_material_categories" ADD CONSTRAINT "role_game_material_categories_role_game_id_role_games_id_fk" FOREIGN KEY ("role_game_id") REFERENCES "public"."role_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_material_categories" ADD CONSTRAINT "role_game_material_categories_parent_category_id_role_game_material_categories_id_fk" FOREIGN KEY ("parent_category_id") REFERENCES "public"."role_game_material_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_game_material_categories" ADD CONSTRAINT "role_game_material_categories_created_by_telegram_user_id_users_telegram_user_id_fk" FOREIGN KEY ("created_by_telegram_user_id") REFERENCES "public"."users"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_game_material_categories_role_game_id_idx" ON "role_game_material_categories" USING btree ("role_game_id");--> statement-breakpoint
CREATE INDEX "role_game_material_categories_parent_category_id_idx" ON "role_game_material_categories" USING btree ("parent_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_game_material_categories_sibling_name_unique" ON "role_game_material_categories" USING btree ("role_game_id","parent_category_id","name");--> statement-breakpoint
ALTER TABLE "role_game_materials" ADD CONSTRAINT "role_game_materials_category_id_role_game_material_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."role_game_material_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_game_materials_category_id_idx" ON "role_game_materials" USING btree ("category_id");