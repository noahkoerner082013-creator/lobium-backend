
import admin from "firebase-admin";
import http from "node:http";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: "lobium-a3684"
  });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json"
  });

  res.end(JSON.stringify({
    app: "Lobium OS",
    status: "Backend running"
  }));
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`Lobium backend running on port ${port}`);
});
