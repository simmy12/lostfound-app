require("dotenv").config();
const express = require("express");
const cors = require("cors");

const catalogRoutes = require("./routes/catalog");
const reportsRoutes = require("./routes/reports");
const adminRoutes = require("./routes/admin");

const app = express();
// CLIENT_ORIGIN restricts CORS to the deployed client's origin; unset (local dev) allows all.
app.use(cors(process.env.CLIENT_ORIGIN ? { origin: process.env.CLIENT_ORIGIN } : undefined));
app.use(express.json());

app.use("/api", catalogRoutes);
app.use("/api", reportsRoutes);
app.use("/api", adminRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// catches anything forwarded via next(err) from asyncHandler-wrapped routes — without this,
// an async route error would otherwise be an unhandled rejection that crashes the process.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`lostfound API listening on :${port}`));
