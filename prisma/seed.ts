import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Admin@1234", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@masterrepo.com" },
    update: {},
    create: {
      email: "admin@masterrepo.com",
      name: "Admin User",
      passwordHash,
      role: "admin",
      userType: "EXTERNAL",
      authType: "LOCAL",
    },
  });

  const viewer = await prisma.user.upsert({
    where: { email: "viewer@masterrepo.com" },
    update: {},
    create: {
      email: "viewer@masterrepo.com",
      name: "Viewer User",
      passwordHash: await bcrypt.hash("Viewer@1234", 10),
      role: "viewer",
      userType: "EXTERNAL",
      authType: "LOCAL",
    },
  });

  console.log("✅ Seeded users:");
  console.log(`   admin  → ${admin.email}  (password: Admin@1234)`);
  console.log(`   viewer → ${viewer.email} (password: Viewer@1234)`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
