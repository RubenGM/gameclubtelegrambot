UPDATE "storage_categories"
SET "category_purpose" = 'catalog_media'
WHERE "category_purpose" = 'user_uploads'
  AND (
    "slug" IN ('catalog-media', 'catalog_media')
    OR lower("display_name") IN ('imagenes de catalogo', 'imágenes de catálogo')
  );
