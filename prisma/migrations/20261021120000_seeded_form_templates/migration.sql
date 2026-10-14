-- Seeded form templates (#153): the Women's Retreat, Camp Meeting and Spring
-- Camporee registration forms move from source to versioned seeded data.
-- Additive: two new tables. Nothing existing is read, changed or backfilled; the
-- rows are written by `npm run form-templates:sync`, and no existing event or
-- registration form version is touched.

CREATE TABLE "SeededFormTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeededFormTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeededFormTemplate_key_key" ON "SeededFormTemplate"("key");

CREATE TABLE "SeededFormTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeededFormTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeededFormTemplateVersion_templateId_version_key" ON "SeededFormTemplateVersion"("templateId", "version");

ALTER TABLE "SeededFormTemplateVersion" ADD CONSTRAINT "SeededFormTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SeededFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
