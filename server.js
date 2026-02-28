import express from "express";
import crypto from "crypto";
import cors from "cors";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

// __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// CORS
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

// ✅ Serve frontend
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// ✅ Homepage route
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const PENDING = new Map();

function makeCode() {
  return "NEON-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}
function now() {
  return Date.now();
}

async function getUserIdByUsername(username) {
  const res = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  if (!res.ok) throw new Error(`Roblox usernames API failed: ${res.status}`);
  const data = await res.json();
  return data?.data?.[0]?.id || null;
}

async function getUserById(userId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
  if (!res.ok) throw new Error(`Roblox users API failed: ${res.status}`);
  return await res.json();
}

app.post("/auth/roblox/start", async (req, res) => {
  try {
    const usernameRaw = (req.body?.username || "").trim();
    if (!usernameRaw) return res.status(400).json({ error: "Missing username" });

    const usernameKey = usernameRaw.toLowerCase();
    const userId = await getUserIdByUsername(usernameRaw);
    if (!userId) return res.status(404).json({ error: "Username not found on Roblox" });

    const code = makeCode();
    PENDING.set(usernameKey, { code, userId, expiresAt: now() + 5 * 60_000 });

    return res.json({
      username: usernameRaw,
      userId,
      code,
      instructions:
        "Open your Roblox profile and paste this code into your About (description). Save, then click 'I’ve updated it'.",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.post("/auth/roblox/check", async (req, res) => {
  try {
    const usernameRaw = (req.body?.username || "").trim();
    if (!usernameRaw) return res.status(400).json({ error: "Missing username" });

    const usernameKey = usernameRaw.toLowerCase();
    const record = PENDING.get(usernameKey);
    if (!record) return res.status(400).json({ error: "No pending verification for this user" });

    if (now() > record.expiresAt) {
      PENDING.delete(usernameKey);
      return res.status(410).json({ error: "Verification code expired. Start again." });
    }

    const userId = record.userId || (await getUserIdByUsername(usernameRaw));
    if (!userId) return res.status(404).json({ error: "Username not found" });

    const user = await getUserById(userId);
    const found = (user?.description || "").includes(record.code);

    if (!found) {
      return res.json({
        verified: false,
        hint: "Code not found in About yet. It can take a minute to propagate.",
      });
    }

    PENDING.delete(usernameKey);
    const token = jwt.sign(
      { sub: String(userId), username: user.name, provider: "roblox" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      verified: true,
      user: { userId, username: user.name, displayName: user.displayName },
      token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

// ✅ Render port
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("Server listening on port " + PORT));
