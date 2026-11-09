import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Match Next.js's local-file precedence; Neon pulls credentials into .env.local.
config({ path: [".env.local", ".env"] });

const baseConfig = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
};

export default process.env.DATABASE_URL_UNPOOLED
  ? defineConfig({
      ...baseConfig,
      engine: "classic",
      datasource: { url: process.env.DATABASE_URL_UNPOOLED },
    })
  : defineConfig(baseConfig);
