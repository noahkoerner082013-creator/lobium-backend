
/*
 LOBIUM OS — FRIENDS API V1
 File: api/friends.js
 Real Firebase friends and friend requests.
*/

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

const ORIGIN =
  "https://noahkoerner082013-creator.github.io";

function database() {
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

function hash(value) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function requestId(from, to) {
  return hash(from + "\0" + to);
}

function friendshipId(a, b) {
  return hash([a, b].sort().join("\0"));
}

function validName(name) {
  return typeof name === "string" &&
    /^[a-zA-Z0-9_-]{3,20}$/.test(name);
}

async function authenticate(db, req) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7).trim();

  if (!/^[a-f0-9]{64}$/i.test(token)) return null;

  const session = await db
    .collection("lobium_sessions")
    .doc(hash(token))
    .get();

  if (!session.exists) return null;

  const data = session.data();

  if (
    !data ||
    typeof data.usernameKey !== "string" ||
    typeof data.expiresAt !== "number" ||
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
    key: data.usernameKey,
    name: account.data().username
  };
}

async function username(db, key) {
  const doc = await db.collection("lobium_accounts")
    .doc(key).get();

  return doc.exists ? doc.data().username : key;
}

async function getList(db, me) {
  const requests = db.collection(
    "lobium_friend_requests"
  );

  const friendships = db.collection(
    "lobium_friendships"
  );

  const [incoming, outgoing, friends] =
    await Promise.all([
      requests.where("to", "==", me).limit(100).get(),
      requests.where("from", "==", me).limit(100).get(),
      friendships.where(
        "users", "array-contains", me
      ).limit(100).get()
    ]);

  const friendKeys = friends.docs.map(doc =>
    doc.data().users.find(key => key !== me)
  ).filter(Boolean);

  const incomingKeys = incoming.docs.map(
    doc => doc.data().from
  );

  const outgoingKeys = outgoing.docs.map(
    doc => doc.data().to
  );

  const allKeys = [...new Set([
    ...friendKeys,
    ...incomingKeys,
    ...outgoingKeys
  ])];

  const names = new Map(
    await Promise.all(allKeys.map(async key => [
      key,
      await username(db, key)
    ]))
  );

  return {
    friends: friendKeys.map(key => names.get(key)),
    incoming: incomingKeys.map(key => names.get(key)),
    outgoing: outgoingKeys.map(key => names.get(key))
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.headers.origin === ORIGIN) {
    res.setHeader(
      "Access-Control-Allow-Origin", ORIGIN
    );
  }

  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const db = database();
    const current = await authenticate(db, req);

    if (!current) {
      return res.status(401).json({
        error: "Please log in again"
      });
    }

    const me = current.key;

    if (req.method === "GET") {
      const result = await getList(db, me);

      return res.status(200).json({
        success: true,
        ...result
      });
    }

    const body = req.body || {};
    const action = body.action;
    const target = body.username;

    if (!validName(target)) {
      return res.status(400).json({
        error: "Invalid username"
      });
    }

    const other = target.toLowerCase();

    if (me === other) {
      return res.status(400).json({
        error: "You cannot friend yourself"
      });
    }

    const accounts = db.collection(
      "lobium_accounts"
    );

    const requests = db.collection(
      "lobium_friend_requests"
    );

    const friendships = db.collection(
      "lobium_friendships"
    );

    const friendRef = friendships.doc(
      friendshipId(me, other)
    );

    const outgoingRef = requests.doc(
      requestId(me, other)
    );

    const incomingRef = requests.doc(
      requestId(other, me)
    );

    if (action === "request") {
      const targetAccount = await accounts
        .doc(other).get();

      if (!targetAccount.exists) {
        return res.status(404).json({
          error: "User not found"
        });
      }

      const result = await db.runTransaction(
        async tx => {
          const [friend, sent, reverse] =
            await Promise.all([
              tx.get(friendRef),
              tx.get(outgoingRef),
              tx.get(incomingRef)
            ]);

          if (friend.exists) {
            return "Already friends";
          }

          if (sent.exists) {
            return "Request already sent";
          }

          if (reverse.exists) {
            return "They already sent you a request";
          }

          tx.create(outgoingRef, {
            from: me,
            to: other,
            createdAt: Date.now()
          });

          return "Friend request sent";
        }
      );

      return res.status(200).json({
        success: true,
        message: result
      });
    }

    if (action === "accept") {
      const result = await db.runTransaction(
        async tx => {
          const [request, friend] =
            await Promise.all([
              tx.get(incomingRef),
              tx.get(friendRef)
            ]);

          if (!request.exists) {
            return false;
          }

          if (!friend.exists) {
            tx.create(friendRef, {
              users: [me, other].sort(),
              createdAt: Date.now()
            });
          }

          tx.delete(incomingRef);
          tx.delete(outgoingRef);

          return true;
        }
      );

      if (!result) {
        return res.status(404).json({
          error: "Friend request not found"
        });
      }

      return res.status(200).json({
        success: true,
        message: "You are now friends!"
      });
    }

    if (action === "decline") {
      await incomingRef.delete();

      return res.status(200).json({
        success: true,
        message: "Request declined"
      });
    }

    if (action === "cancel") {
      await outgoingRef.delete();

      return res.status(200).json({
        success: true,
        message: "Request cancelled"
      });
    }

    if (action === "remove") {
      await friendRef.delete();

      return res.status(200).json({
        success: true,
        message: "Friend removed"
      });
    }

    return res.status(400).json({
      error: "Unknown friend action"
    });

  } catch (error) {
    console.error(
      "Lobium friends API:",
      error.message
    );

    return res.status(500).json({
      error: "Friends service unavailable"
    });
  }
}
