
import admin from "firebase-admin";

function getFirebase() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIRE_PROJECT_ID
    });
  }

  return admin.firestore();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const db = getFirebase();
    // await db.listCollections();

    return res.status(200).json({
      app: "Lobium OS",
      status: "Firebase connected",
      firebaseProject: process.env.FIREBASE_PROJECT_ID
    });
  } catch (error) {
    console.error("Firebase initialization failed:", error.message);

    return res.status(500).json({
      error: "Firebase connection failed",
      code: error.code
    });
  }
}
