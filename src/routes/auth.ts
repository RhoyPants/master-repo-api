import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { authenticate } from "../middleware/auth";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  try {
    const { email, password, name, role = "viewer" } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      role?: "admin" | "viewer";
    };

    if (!email || !password || !name) {
      return res.status(400).json({ message: "email, password, and name are required" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role,
        userType: "EXTERNAL",
        authType: "LOCAL",
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    return res.status(201).json({ user });
  } catch (error) {
    return res.status(500).json({ message: "Failed to register user", error });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        email: user.email,
        role: user.role,
      },
      env.jwtSecret,
      {
        subject: String(user.id),
        expiresIn: "8h",
      },
    );

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to login", error });
  }
});

authRouter.get("/me", authenticate, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return res.status(200).json({ user: req.user });
});
