
/*
 LOBIUM OS — ONLINE MEMBERS API
 New file: api/online.js
 Keeps existing accounts and chat unchanged.
*/

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

const OWNER_USERNAME = "lord-of-blocks13";
const ONLINE_TIMEOUT = 60000;

const RANKS = [
  "Unranked",
  "Starter",
  "Mod",
  "Admin",
  "Co-Owner",
  "Owner"
];

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

function getRank(account, usernameKey) {
  if (usernameKey === OWNER_USERNAME) {
    return "Owner";
  }

  return RANKS.includes(account.rank)
    ? account.rank
    : "Unranked";
}

async function authenticate(db, req) {
  const authorization =
    req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return null;
  }

  const hash = createHash("sha256")
    .update(token)
    .digest("hex");

  const session = await db
    .collection("lobium_sessions")
    .doc(hash)
    .get();

  if (!session.exists) return null;

  const data = session.data();

  if (
    !data ||
    !data.usernameKey ||
    data.expiresAt <= Date.now()
  ) {
    return null;
  }

  const account = await db
    .collection("lobium_accounts")
    .doc(data.usernameKey)
    .get();

  if (!account.exists) return null;

  return {
    usernameKey: data.usernameKey,
    account: account.data()
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin;

  if (
    origin ===
    "https://google-classroom-lobium-os.neocities.org"
  ) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      origin
    );
    res.setHeader(
      "Vary",
      "Origin"
    );
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (
    req.method !== "GET" &&
    req.method !== "POST"
  ) {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const db = getDatabase();
    const currentTime = Date.now();

    // Heartbeat: securely mark current user online.
    if (req.method === "POST") {
      const user = await authenticate(db, req);

      if (!user) {
        return res.status(401).json({
          error: "Login required"
        });
      }

      await db
        .collection("lobium_presence")
        .doc(user.usernameKey)
        .set({
          lastSeen: currentTime
        });

      return res.status(200).json({
        success: true
      });
    }

    // Get recently active users.
    const snapshot = await db
      .collection("lobium_presence")
      .where(
        "lastSeen",
        ">=",
        currentTime - ONLINE_TIMEOUT
      )
      .limit(100)
      .get();

    const online = await Promise.all(
      snapshot.docs.map(async function(doc) {
        const accountSnapshot = await db
          .collection("lobium_accounts")
          .doc(doc.id)
          .get();

        if (!accountSnapshot.exists) return null;

        const account = accountSnapshot.data();

        return {
          name: account.username,
          rank: getRank(account, doc.id),
          createdAt: account.createdAt || null
        };
      })
    );

    const users = online.filter(Boolean);

    users.sort(function(a, b) {
      return (
        RANKS.indexOf(b.rank) -
        RANKS.indexOf(a.rank)
      ) || a.name.localeCompare(b.name);
    });

    return res.status(200).json({
      success: true,
      users: users,
      count: users.length
    });

  } catch (error) {
    console.error(
      "Lobium online API error:",
      error.message
    );

    return res.status(500).json({
      error: "Online members unavailable"
    });
  }
}
