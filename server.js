// server.js
import express from "express";
import crypto from "crypto";
import cors from "cors";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());
app.use(cors({ origin: ["https://your-site.com", "http://localhost:5173"], credentials: true }));

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const PENDING = new Map(); // key=username (lowercase), value={ code, expiresAt, userId? }

function makeCode() {
  return "NEON-" + crypto.randomBytes(3).toString("hex").toUpperCase(); // e.g., NEON-7F3A2C
}

function now() { return Date.now(); }

// --- Roblox helpers (server-side fetch avoids CORS) ---
async function getUserIdByUsername(username) {
  const res = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  if (!res.ok) throw new Error(`Roblox usernames API failed: ${res.status}`);
  const data = await res.json(); // { data: [{ id, name, displayName }...] }
  return (data?.data?.[0]?.id) || null;
  // Endpoint: POST /v1/usernames/users (maps username to id)  — Roblox Users v1
  // https://create.roblox.com/docs/cloud/legacy/users
}

async function getUserById(userId) {
  const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
  if (!res.ok) throw new Error(`Roblox users API failed: ${res.status}`);
  return await res.json(); // { id, name, displayName, description, ... }
  // Endpoint: GET /v1/users/{userId} (public detailed user info incl. description)
}

// --- Start verification: issue code ---
app.post("/auth/roblox/start", async (req, res) => {
  try {
    const usernameRaw = (req.body?.username || "").trim();
    if (!usernameRaw) return res.status(400).json({ error: "Missing username" });

    const username = usernameRaw.toLowerCase();
    const userId = await getUserIdByUsername(usernameRaw); // may be null if not found
    if (!userId) return res.status(404).json({ error: "Username not found on Roblox" });

    const code = makeCode();
    PENDING.set(username, { code, userId, expiresAt: now() + 5 * 60_000 }); // 5 minutes

    return res.json({
      username: usernameRaw,
      userId,
      code,
      instructions: "Open your Roblox profile and paste this code into your About (description). Save, then click 'I’ve updated it'."
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

// --- Poll verification: check profile description for the code ---
app.post("/auth/roblox/check", async (req, res) => {
  try {
    const usernameRaw = (req.body?.username || "").trim();
    const username = usernameRaw.toLowerCase();
    const record = PENDING.get(username);
    if (!record) return res.status(400).json({ error: "No pending verification for this user" });

    if (now() > record.expiresAt) {
      PENDING.delete(username);
      return res.status(410).json({ error: "Verification code expired. Start again." });
    }

    const userId = record.userId || await getUserIdByUsername(usernameRaw);
    if (!userId) return res.status(404).json({ error: "Username not found" });

    const user = await getUserById(userId); // contains .description
    const found = (user?.description || "").includes(record.code);

    if (!found) {
      return res.json({ verified: false, hint: "Code not found in About yet. It can take a minute to propagate." });
    }

    // Success: mint a session
    PENDING.delete(username);
    const token = jwt.sign(
      { sub: String(userId), username: user.name, provider: "roblox" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      verified: true,
      user: { userId, username: user.name, displayName: user.displayName },
      token
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.listen(3001, () => console.log("Auth server listening on http://localhost:3001"));
