
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

// LOBIUM DM'S — PUBLIC CHAT READER
// Does not change the working index.js

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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const db = getDatabase();

    const snapshot = await db
      .collection("lobium_public_messages")
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();

    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      username: doc.get("username") || "Unknown",
      text: doc.get("text") || "",
      createdAt: doc.get("createdAt") || 0
    }));

    return res.status(200).json({
      status: "working",
      messages: messages.reverse()
    });

  } catch (error) {
    console.error("Message read failed:", error.message);

    return res.status(500).json({
      error: "Unable to load messages"
    });
  }
}
