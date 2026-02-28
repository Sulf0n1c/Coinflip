import express from "express";
import crypto from "crypto";
import cors from "cors";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Static files
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Debug route
app.get("/__debug", (req, res) => {
  res.json({
    ok: true,
    service: "backend",
    publicDir,
    time: Date.now(),
    env: {
      FRONTEND_URL: process.env.FRONTEND_URL ? "set" : "missing",
      ROBLOX_CLIENT_ID: process.env.ROBLOX_CLIENT_ID ? "set" : "missing",
      ROBLOX_CLIENT_SECRET: process.env.ROBLOX_CLIENT_SECRET ? "set" : "missing",
      ROBLOX_REDIRECT_URI: process.env.ROBLOX_REDIRECT_URI ? "set" : "missing",
      JWT_SECRET: process.env.JWT_SECRET ? "set" : "missing",
    },
  });
});

// Ensure correct static file responses
app.get("/script.js", (req, res) => res.sendFile(path.join(publicDir, "script.js")));
app.get("/style.css", (req, res) => res.sendFile(path.join(publicDir, "style.css")));
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

// CORS
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

function mustEnv(name) {
  if (!process.env[name]) throw new Error(`Missing env var: ${name}`);
}
["FRONTEND_URL", "ROBLOX_CLIENT_ID", "ROBLOX_CLIENT_SECRET", "ROBLOX_REDIRECT_URI", "JWT_SECRET"].forEach(mustEnv);

// -----------------------------
// ROBLOX OAUTH START
// -----------------------------
app.get("/auth/roblox", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl =
    `https://apis.roblox.com/oauth/v1/authorize` +
    `?client_id=${encodeURIComponent(process.env.ROBLOX_CLIENT_ID)}` +
    `&response_type=code` +
    `&scope=openid%20profile` +
    `&redirect_uri=${encodeURIComponent(process.env.ROBLOX_REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;

  res.redirect(authUrl);
});

// -----------------------------
// ROBLOX OAUTH CALLBACK
// -----------------------------
app.get("/auth/roblox/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");

  try {
    // Exchange code -> access token
    const tokenRes = await fetch("https://apis.roblox.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: process.env.ROBLOX_CLIENT_ID,
        client_secret: process.env.ROBLOX_CLIENT_SECRET,
        redirect_uri: process.env.ROBLOX_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Token exchange failed:", tokenData);
      return res.status(500).send("Token exchange failed");
    }

    const accessToken = tokenData.access_token;

    // Get user info
    const userRes = await fetch("https://apis.roblox.com/oauth/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const userData = await userRes.json();
    if (!userRes.ok) {
      console.error("Userinfo failed:", userData);
      return res.status(500).send("Userinfo failed");
    }

    // Username field can vary
    const username =
      userData.preferred_username ||
      userData.name ||
      userData.nickname ||
      "RobloxUser";

    // Sign JWT for your site
    const siteToken = jwt.sign(
      { id: userData.sub, username, provider: "roblox" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Redirect back to your frontend (same site) with token
    res.redirect(`${process.env.FRONTEND_URL}/?token=${encodeURIComponent(siteToken)}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Auth failed");
  }
});

// -----------------------------
// VERIFY JWT (frontend calls this)
// -----------------------------
app.get("/api/me", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ ok: true, user: payload });
  } catch {
    res.status(401).json({ ok: false, error: "Invalid token" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on port", PORT));
