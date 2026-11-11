
export default function handler(req, res) {
  res.status(200).json({
    app: "Lobium OS",
    status: "Backend running",
    firebaseProject: "lobium-a3684"
  });
}
