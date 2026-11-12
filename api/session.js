
/*
 LOBIUM OS — SECURE SESSION API
 Separate backend add-on.
 Does not modify existing files.
*/

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

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

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
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
      error: "Valid session required"
    });
  }

  try {
    const db = getDatabase();
    const tokenHash = hashToken(match[1]);

    const sessionRef = db
      .collection("lobium_sessions")
      .doc(tokenHash);

    const snapshot = await sessionRef.get();

    if (!snapshot.exists) {
      return res.status(401).json({
        error: "Session not found"
      });
    }

    const session = snapshot.data();

    if (
      typeof session.expiresAt !== "number" ||
      Date.now() >= session.expiresAt
    ) {
      await sessionRef.delete();

      return res.status(401).json({
        error: "Session expired"
      });
    }

    if (req.method === "POST") {
      await sessionRef.delete();

      return res.status(200).json({
        success: true,
        message: "Logged out"
      });
    }

    const accountRef = db
      .collection("lobium_accounts")
      .doc(session.usernameKey);

    const accountSnapshot = await accountRef.get();

    if (!accountSnapshot.exists) {
      return res.status(401).json({
        error: "Account not found"
      });
    }

    const account = accountSnapshot.data();

    return res.status(200).json({
      success: true,
      authenticated: true,
      username: account.username,
      rank: account.rank || "Unranked",
      expiresAt: session.expiresAt
    });

  } catch (error) {
    console.error(
      "Lobium session error:",
      error.code || error.message
    );

    return res.status(500).json({
      error: "Session service unavailable"
    });
  }
}
