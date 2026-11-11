
import admin from "firebase-admin";

function getFirebase() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    );
if (serviceAccount.project_id !== process.env.FIREBASE_PROJECT_ID) {
  throw new Error(
    "Project mismathc: service account=" +
    serviceAccount.project_id +
   ", environment=" +
   process.env.FIREBASE_PROJECT_ID
  );
}
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID
    });
  }

  return admin.firestore("default");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const db = getFirebase();
    await db.collection("lobium_connection_test").doc("check").set({
      status: "working"
    });
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
