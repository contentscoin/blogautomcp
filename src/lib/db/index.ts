import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma";

if (!process.env.DATABASE_URL) {
  const basePath = process.env.DESKTOP_USER_DATA || process.cwd();
  const databasePath = path.join(
    basePath,
    process.env.DESKTOP_USER_DATA ? "data" : "prisma",
    "blogautomcp.db",
  );
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma 7에서는 prisma.config.ts에서 URL 설정
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
