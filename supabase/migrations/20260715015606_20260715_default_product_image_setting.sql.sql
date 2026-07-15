/*
# Default Product Image Setting

1. Changes
- Adds a `product_defaults` setting to the `app_settings` table.
- Contains a `default_image_url` field used as fallback when a product has no image.
- Allows changing the default image later without touching individual products.

2. Security
- No new tables. Uses existing `app_settings` table and its RLS policies.
*/

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('product_defaults', '{"default_image_url": ""}')
ON CONFLICT (setting_key) DO NOTHING;
