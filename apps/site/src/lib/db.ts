import { PrismaClient } from "@/generated/prisma";

const globalForSitePrisma = globalThis as unknown as {
  sitePrisma?: PrismaClient;
};

export const db = globalForSitePrisma.sitePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForSitePrisma.sitePrisma = db;
}
