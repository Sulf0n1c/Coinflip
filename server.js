import express from "express";
import cors from "cors";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// CORS (frontend must match)
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));

function mustEnv(name) {
  if (!process.env[name]) throw new Error(`Missing env var: ${name}`);
}
["FRONTEND_URL","ROBLOX_CLIENT_ID","ROBLOX_CLIENT_SECRET","ROBLOX_REDIRECT_URI","JWT_SECRET"].forEach(mustEnv);

// -----------------------------
// ROBLOX LOGIN START
// -----------------------------
app.get("/auth/roblox", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");

  // (Optional) store state in cookie/session later if you want
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
// ROBLOX CALLBACK
// -----------------------------
app.get("/auth/roblox/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");

  try {
    // Exchange code for token
    const tokenRes = await fetch("https://apis.roblox.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: process.env.ROBLOX_CLIENT_ID,
        client_secret: process.env.ROBLOX_CLIENT_SECRET,
        redirect_uri: process.env.ROBLOX_REDIRECT_URI
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Token exchange failed:", tokenData);
      return res.status(500).send("Token exchange failed");
    }

    const accessToken = tokenData.access_token;

    // Get userinfo
    const userRes = await fetch("https://apis.roblox.com/oauth/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const userData = await userRes.json();
    if (!userRes.ok) {
      console.error("Userinfo failed:", userData);
      return res.status(500).send("Userinfo failed");
    }

    // Roblox fields can vary; prefer username-like fields when present
    const username =
      userData.preferred_username ||
      userData.name ||
      userData.nickname ||
      "RobloxUser";

    const token = jwt.sign(
      { id: userData.sub, username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.redirect(`${process.env.FRONTEND_URL}/?token=${encodeURIComponent(token)}`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Auth failed");
  }
});

// -----------------------------
// VERIFY JWT + RETURN USER
// -----------------------------
app.get("/api/me", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return res.json({ ok: true, user: payload });
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
