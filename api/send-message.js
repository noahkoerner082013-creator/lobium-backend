
/*
 LOBIUM OS — SECURE PUBLIC MESSAGE SENDER
 Separate add-on. Does not modify existing APIs.
*/

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

const COOLDOWN = 3000;
const MAX_LENGTH = 500;

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

function hashToken(token) {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const authorization = req.headers.authorization || "";
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(
    authorization
  );

  if (!match) {
    return res.status(401).json({
      error: "Login required"
    });
  }

  const message = req.body?.text;

  if (
    typeof message !== "string" ||
    !message.trim() ||
    message.trim().length > MAX_LENGTH
  ) {
    return res.status(400).json({
      error: "Message must be 1-500 characters"
    });
  }

  try {
    const db = getDatabase();

    const sessionDoc = await db
      .collection("lobium_sessions")
      .doc(hashToken(match[1]))
      .get();

    if (!sessionDoc.exists) {
      return res.status(401).json({
        error: "Session not found"
      });
    }

    const session = sessionDoc.data();

    if (
      typeof session.expiresAt !== "number" ||
      Date.now() >= session.expiresAt
    ) {
      return res.status(401).json({
        error: "Session expired"
      });
    }

    if (typeof session.usernameKey !== "string") {
      return res.status(401).json({
        error: "Invalid session"
      });
    }

    const accountRef = db
      .collection("lobium_accounts")
      .doc(session.usernameKey);

    const messageRef = db
      .collection("lobium_public_messages")
      .doc();

    const result = await db.runTransaction(
      async transaction => {
        const accountDoc = await transaction.get(
          accountRef
        );

        if (!accountDoc.exists) {
          return { error: "Account not found", status: 401 };
        }

        const account = accountDoc.data();
        const now = Date.now();

        if (account.banned === true) {
          return { error: "Account banned", status: 403 };
        }

        if (account.muted === true) {
          return { error: "Account muted", status: 403 };
        }

        const last = account.lastMessageAt || 0;

        if (now - last < COOLDOWN) {
          return {
            error: "Please wait 3 seconds",
            status: 429
          };
        }

        transaction.update(accountRef, {
          lastMessageAt: now
        });

        transaction.create(messageRef, {
          username: account.username,
          usernameKey: session.usernameKey,
          text: message.trim(),
          createdAt: now
        });

        return {
          success: true,
          id: messageRef.id
        };
      }
    );

    if (!result.success) {
      return res.status(result.status).json({
        error: result.error
      });
    }

    return res.status(201).json({
      success: true,
      message: "Message saved",
      id: result.id
    });

  } catch (error) {
    console.error(
      "Lobium message error:",
      error.code || error.message
    );

    return res.status(500).json({
      error: "Unable to send message"
    });
  }
}
