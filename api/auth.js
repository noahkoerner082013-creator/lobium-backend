
/*
 LOBIUM OS — SECURE ACCOUNT API
 Separate add-on. Does not modify index.js.
*/

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_LENGTH = 7 * 24 * 60 * 60 * 1000;

function getDatabase() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    );

    if (
      serviceAccount.project_id !==
      process.env.FIREBASE_PROJECT_ID
    ) {
      throw new Error("Firebase project mismatch");
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID
    });
  }

  return getFirestore("default");
}

function sessionHash(token) {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);

  return {
    salt,
    passwordHash: derived.toString("hex")
  };
}

async function checkPassword(password, account) {
  if (
    typeof account.salt !== "string" ||
    typeof account.passwordHash !== "string"
  ) {
    return false;
  }

  const stored = Buffer.from(
    account.passwordHash,
    "hex"
  );

  if (stored.length !== 64) return false;

  const derived = await scrypt(
    password,
    account.salt,
    64
  );

  return timingSafeEqual(stored, derived);
}

async function createSession(db, usernameKey) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_LENGTH;

  await db.collection("lobium_sessions")
    .doc(sessionHash(token))
    .set({
      usernameKey,
      expiresAt,
      createdAt: Date.now()
    });

  return { token, expiresAt };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};
    const action = body.action;
    const username = body.username;
    const password = body.password;

    if (action !== "register" && action !== "login") {
      return res.status(400).json({
        error: "Invalid account action"
      });
    }

    if (
      typeof username !== "string" ||
      !/^[a-zA-Z0-9_-]{3,20}$/.test(username)
    ) {
      return res.status(400).json({
        error: "Username must be 3-20 letters, numbers, underscores or hyphens"
      });
    }

    if (
      typeof password !== "string" ||
      password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 256
    ) {
      return res.status(400).json({
        error: "Password must be at least 8 characters and at most 256 bytes"
      });
    }

    const db = getDatabase();
    const usernameKey = username.toLowerCase();

    const accountRef = db
      .collection("lobium_accounts")
      .doc(usernameKey);

    if (action === "register") {
      const credentials = await hashPassword(password);

      const account = {
        username,
        usernameKey,
        salt: credentials.salt,
        passwordHash: credentials.passwordHash,
        rank: "Unranked",
        createdAt: Date.now()
      };

      try {
        await db.runTransaction(async transaction => {
          const existing = await transaction.get(
            accountRef
          );

          if (existing.exists) {
            throw new Error("USERNAME_TAKEN");
          }

          transaction.create(accountRef, account);
        });
      } catch (error) {
        if (error.message === "USERNAME_TAKEN" ||
            error.code === 6) {
          return res.status(409).json({
            error: "Username already taken"
          });
        }
        throw error;
      }

      const session = await createSession(
        db,
        usernameKey
      );

      return res.status(201).json({
        success: true,
        message: "Account created",
        username,
        rank: "Unranked",
        token: session.token,
        expiresAt: session.expiresAt
      });
    }

    if (action === "login") {
      const snapshot = await accountRef.get();

      if (!snapshot.exists) {
        return res.status(401).json({
          error: "Incorrect username or password"
        });
      }

      const account = snapshot.data();

      const valid = await checkPassword(
        password,
        account
      );

      if (!valid) {
        return res.status(401).json({
          error: "Incorrect username or password"
        });
      }

      const session = await createSession(
        db,
        usernameKey
      );

      return res.status(200).json({
        success: true,
        message: "Logged in",
        username: account.username,
        rank: account.rank,
        token: session.token,
        expiresAt: session.expiresAt
      });
    }

  } catch (error) {
    console.error(
      "Lobium auth error:",
      error.code || error.message
    );

    return res.status(500).json({
      error: "Account service unavailable"
    });
  }
}
