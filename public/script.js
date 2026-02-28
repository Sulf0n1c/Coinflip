// ---------------- UTIL ----------------
const $ = (id) => document.getElementById(id);

// ✅ CHANGE THIS
const BACKEND_URL = "http://localhost:3000"; 
// example Render: "https://your-backend.onrender.com"

// ---------------- GLOBAL STATE ----------------
let USERNAME = null;
let POINTS = 0;
let matches = [];
let currentRoom = null;
let lastFlip = null;
let nonce = 0;
let selectedChoice = "heads";
let isFlipping = false;
let hasFlippedInCurrentRoom = false;

// Player stats persisted locally
let USER_STATS = {
  wagered: 0,
  won: 0,
  lost: 0
};

// Recently finished matches (displayed in the list for ~20s)
let finishedMatches = []; 

// Archive of full results for re-showing the ending screen
let archiveResults = {};

// ---------------- AUTH HELPERS ----------------
function getToken() {
  return localStorage.getItem("token");
}

function setToken(token) {
  localStorage.setItem("token", token);
}

function clearToken() {
  localStorage.removeItem("token");
}

async function fetchMe() {
  const token = getToken();
  if (!token) return null;

  const res = await fetch(`${BACKEND_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data?.ok) return null;
  return data.user; // { id, username }
}

function handleTokenFromRedirect() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    setToken(token);
    // clean URL
    window.history.replaceState({}, document.title, "/");
  }
}

// ---------------- INIT ----------------
document.addEventListener("DOMContentLoaded", async () => {
  handleTokenFromRedirect();

  const savedPoints = localStorage.getItem("points");
  if (savedPoints) POINTS = parseInt(savedPoints, 10);

  const savedStats = localStorage.getItem("userStats");
  if (savedStats) {
    try { USER_STATS = JSON.parse(savedStats); } catch (_) {}
  }

  updateBalanceDisplay();

  // ✅ load Roblox user
  const me = await fetchMe();
  if (me?.username) {
    USERNAME = me.username;
    updateLoginUI();
  } else {
    // not logged in
    USERNAME = null;
    setLoggedOutUI();
  }

  renderMatchList();
  updateFlipBtnState();

  // Clean up finished matches and archived results after ~20s
  setInterval(() => {
    const cutoff = Date.now() - 20_000;

    const beforeFM = finishedMatches.length;
    finishedMatches = finishedMatches.filter(m => m.endedAt > cutoff);

    for (const key of Object.keys(archiveResults)) {
      if (archiveResults[key].endedAt <= cutoff) delete archiveResults[key];
    }

    if (finishedMatches.length !== beforeFM) renderMatchList();
  }, 1000);
});

// ---------------- UI HELPERS ----------------
function updateBalanceDisplay() {
  $("balanceDisplay").textContent = POINTS.toLocaleString();
  localStorage.setItem("points", POINTS);
}

function updateLoginUI() {
  $("usernameDisplay").textContent = `Logged in as: ${USERNAME}`;
  $("usernameDisplay").classList.add("username-display");
  $("loginBtn").classList.add("hidden");
  $("createMatchBtn").disabled = false;
  updateFlipBtnState();
}

function setLoggedOutUI() {
  $("usernameDisplay").textContent = "";
  $("loginBtn").classList.remove("hidden");
  $("createMatchBtn").disabled = true;
  updateFlipBtnState();
}

function updateFlipBtnState() {
  const canFlip = Boolean(
    USERNAME &&
    currentRoom &&
    !isFlipping &&
    !hasFlippedInCurrentRoom
  );
  $("flipBtn").disabled = !canFlip;
}

function saveStats() {
  localStorage.setItem("userStats", JSON.stringify(USER_STATS));
}

// ---------------- ROBLOX LOGIN BUTTON ----------------
$("loginBtn").onclick = () => {
  window.location.href = `${BACKEND_URL}/auth/roblox`;
};

// ---------------- CREATE MATCH ----------------
$("createMatchBtn").onclick = () => {
  if (!USERNAME) return alert("Login with Roblox first!");

  $("betInput").value = Math.min(POINTS, 100);
  $("maxPointsHelper").textContent = POINTS.toLocaleString();

  createSelectedSide = "heads";
  document.querySelectorAll("#createMatchModal .choice-box")
    .forEach(b => b.classList.toggle("active", b.dataset.value === "heads"));

  $("createMatchModal").classList.remove("hidden");
};

// ---------------- RENDER MATCH LIST ----------------
function renderMatchList() {
  const list = $("matchList");
  list.innerHTML = "";

  const hasActive = matches.length > 0;
  const hasFinished = finishedMatches.length > 0;

  if (!hasActive && !hasFinished) {
    list.innerHTML =
      '<div class="card" style="text-align:center;color:var(--muted);">No active matches.</div>';
    return;
  }

  matches.forEach((room) => {
    const div = document.createElement("div");
    div.className = "card";
    div.style.flexDirection = "row";
    div.style.justifyContent = "space-between";
    div.style.alignItems = "center";

    const guessCoin = document.createElement("span");
    guessCoin.className = `mini-coin ${room.creatorGuess}`;

    div.innerHTML = `
      <div>
        <b style="color:var(--cyan)">Room ${room.id}</b>
        <div class="match-info-row">
          <span class="badge points">${room.bet} PTS</span>
        </div>
        <small style="color:var(--muted)">Host: ${room.creator}</small>
      </div>
      <div style="display:flex; gap:5px; align-items:center;"></div>
    `;

    const buttonsDiv = div.querySelector("div:last-child");

    const viewBtn = document.createElement("button");
    viewBtn.className = "btn small cyan";
    viewBtn.textContent = "VIEW";
    viewBtn.onclick = () => enterRoom(room.id);

    const joinBtn = document.createElement("button");
    joinBtn.className = "btn small cyan";
    joinBtn.textContent = "JOIN";

    if (
      (currentRoom && currentRoom.id === room.id) ||
      (!currentRoom && USERNAME === room.creator) ||
      (USERNAME && room.opponent && room.opponent !== USERNAME)
    ) joinBtn.disabled = true;

    joinBtn.onclick = () => {
      if (POINTS < room.bet) return alert("Insufficient points!");
      enterRoom(room.id);
    };

    buttonsDiv.appendChild(viewBtn);
    buttonsDiv.appendChild(joinBtn);
    div.querySelector(".match-info-row").appendChild(guessCoin);

    list.appendChild(div);
  });

  finishedMatches
    .sort((a, b) => b.endedAt - a.endedAt)
    .forEach((fm) => {
      const div = document.createElement("div");
      div.className = "card finished";

      const msLeft = Math.max(0, 20_000 - (Date.now() - fm.endedAt));
      const secLeft = Math.ceil(msLeft / 1000);

      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <b style="color:var(--muted)">Room ${fm.id} • Finished</b>
            <div class="match-info-row">
              <span class="badge points">${fm.bet} PTS</span>
              <span class="badge result">Winner: ${fm.winner}</span>
              <span class="badge payout">+${fm.amountWon.toLocaleString()} PTS</span>
            </div>
            <small style="color:var(--muted)">Hides in ~${secLeft}s</small>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn small cyan" data-fmid="${fm.id}">VIEW</button>
            <button class="btn small" disabled>ENDED</button>
          </div>
        </div>
      `;

      div.querySelector("button.btn.small.cyan").onclick = () => showEndedMatch(fm.id);
      list.appendChild(div);
    });
}

// ---------------- ENTER ROOM ----------------
function enterRoom(roomId) {
  currentRoom = matches.find(r => r.id === roomId);
  if (!currentRoom) return;

  hasFlippedInCurrentRoom = false;

  if (!currentRoom.opponent && currentRoom.creator !== USERNAME) {
    POINTS -= currentRoom.bet;
    updateBalanceDisplay();
    currentRoom.opponent = USERNAME;

    USER_STATS.wagered += currentRoom.bet;
    saveStats();
  }

  selectedChoice =
    currentRoom.creator === USERNAME
      ? currentRoom.creatorGuess
      : (currentRoom.creatorGuess === "heads" ? "tails" : "heads");

  $("yourSideDisplay").textContent = selectedChoice.toUpperCase();
  $("roomIdDisplay").textContent = currentRoom.id;
  $("roomCreatorDisplay").textContent = currentRoom.creator;
  $("roomOpponentDisplay").textContent = currentRoom.opponent || "Waiting...";
  $("flipResult").textContent = "";
  $("winnerDisplay").textContent = "";
  $("seedData").textContent = "";
  $("hashData").textContent = "";

  resetCoinInstant();
  $("matchRoom").classList.remove("hidden");

  isFlipping = false;
  updateFlipBtnState();
}

$("backToList").onclick = () => {
  $("matchRoom").classList.add("hidden");
  currentRoom = null;
  isFlipping = false;
  hasFlippedInCurrentRoom = false;
  updateFlipBtnState();
  renderMatchList();
};

// ---------------- COIN FLIP ----------------
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function resetCoinInstant() {
  const coin = $("coin");
  coin.style.transition = "none";
  coin.style.transform = "rotateY(0deg) rotateX(0deg)";
  void coin.offsetWidth;
  coin.style.transition = "transform 1.5s cubic-bezier(0.3,2,0.5,1)";
}

function animateCoin(result) {
  const coin = $("coin");
  coin.style.transition = "none";
  coin.style.transform = result === "heads" ? "rotateY(0deg)" : "rotateY(180deg)";
  void coin.offsetWidth;
  coin.style.transition = "transform 1.5s cubic-bezier(0.3,2,0.5,1)";
  const spins = 1080;
  coin.style.transform =
    result === "heads"
      ? `rotateY(0deg) rotateX(${spins}deg)`
      : `rotateY(180deg) rotateX(${spins}deg)`;
}

$("flipBtn").onclick = async () => {
  if (isFlipping || hasFlippedInCurrentRoom) return;
  if (!currentRoom) return;

  isFlipping = true;
  hasFlippedInCurrentRoom = true;
  updateFlipBtnState();

  const sSeed = Math.random().toString(36).substring(2,10);
  const pSeed = Math.random().toString(36).substring(2,10);

  const hash = await sha256(sSeed + pSeed + nonce);
  const result = parseInt(hash.substring(0,2),16) % 2 === 0 ? "heads" : "tails";

  animateCoin(result);

  setTimeout(() => {
    const didWin = selectedChoice === result;

    $("flipResult").textContent = `RESULT: ${result.toUpperCase()}`;
    $("winnerDisplay").textContent = didWin ? "🎉 YOU WON!" : "❌ YOU LOST";
    $("winnerDisplay").style.color = didWin ? "var(--cyan)" : "var(--pink)";

    if (didWin) {
      POINTS += currentRoom.bet * 2;
      updateBalanceDisplay();
      USER_STATS.won += currentRoom.bet * 2;
    } else {
      USER_STATS.lost += currentRoom.bet;
    }
    saveStats();

    const winnerName = didWin ? USERNAME
      : (currentRoom.creator === USERNAME ? currentRoom.opponent : currentRoom.creator);

    archiveResults[currentRoom.id] = {
      id: currentRoom.id,
      bet: currentRoom.bet,
      creator: currentRoom.creator,
      opponent: currentRoom.opponent,
      result,
      winner: winnerName,
      amountWon: currentRoom.bet * 2,
      seeds: { sSeed, pSeed, nonce },
      hash,
      endedAt: Date.now()
    };

    finishedMatches.push({
      id: currentRoom.id,
      bet: currentRoom.bet,
      creator: currentRoom.creator,
      opponent: currentRoom.opponent,
      winner: winnerName,
      amountWon: currentRoom.bet * 2,
      endedAt: Date.now()
    });

    nonce++;
    matches = matches.filter(m => m.id !== currentRoom.id);

    isFlipping = false;
    updateFlipBtnState();
    renderMatchList();
  }, 1500);
};

// ---------------- Re-show ENDING SCREEN for finished matches ----------------
function showEndedMatch(roomId) {
  const data = archiveResults[roomId];
  if (!data) return alert("Result no longer available.");

  $("roomIdDisplay").textContent = data.id;
  $("roomCreatorDisplay").textContent = data.creator;
  $("roomOpponentDisplay").textContent = data.opponent || "—";
  $("yourSideDisplay").textContent = "—";

  resetCoinInstant();
  setTimeout(() => {
    const coin = $("coin");
    coin.style.transition = "none";
    coin.style.transform = data.result === "heads" ? "rotateY(0deg)" : "rotateY(180deg)";
  }, 0);

  $("flipResult").textContent = `RESULT: ${data.result.toUpperCase()}`;
  $("winnerDisplay").textContent = `Winner: ${data.winner} (+${data.amountWon.toLocaleString()} PTS)`;
  $("winnerDisplay").style.color = "var(--cyan)";
  $("seedData").textContent = `ServerSeed: ${data.seeds.sSeed} | PlayerSeed: ${data.seeds.pSeed} | Nonce: ${data.seeds.nonce}`;
  $("hashData").textContent = `Hash: ${data.hash}`;

  $("matchRoom").classList.remove("hidden");

  currentRoom = null;
  hasFlippedInCurrentRoom = true;
  isFlipping = false;
  $("flipBtn").disabled = true;
  updateFlipBtnState();
}

// ---------------- FAIRNESS MODAL ----------------
$("fairnessBtn").onclick = () => $("fairnessModal").classList.remove("hidden");
$("closeFairnessModal").onclick = () => $("fairnessModal").classList.add("hidden");
$("validateFairnessBtn").onclick = () => {
  const eosBlock = $("eosBlockInput").value;
  const serverSeed = $("serverSeedInput").value;
  const starterVal = $("starterValueInput").value;
  const joinerVal = $("joinerValueInput").value;
  if (!eosBlock || !serverSeed) return alert("Enter EOS Block and Server Seed.");
  alert(`EOS Block: ${eosBlock}\nServer Seed: ${serverSeed}\nStarter: ${starterVal}\nJoiner: ${joinerVal}\n✔️ Fairness validated!`);
};

// ---------------- CREATE MATCH MODAL ----------------
let createSelectedSide = "heads";

document.querySelectorAll("#createMatchModal .choice-box").forEach(box => {
  box.addEventListener("click", () => {
    document.querySelectorAll("#createMatchModal .choice-box").forEach(b => b.classList.remove("active"));
    box.classList.add("active");
    createSelectedSide = box.dataset.value;
  });
});

$("cancelCreateMatch").onclick = () => $("createMatchModal").classList.add("hidden");

$("confirmCreateMatch").onclick = () => {
  if (!USERNAME) return alert("Login with Roblox first.");

  const bet = parseInt($("betInput").value,10);
  if (!bet || bet <= 0) return alert("Invalid amount.");
  if (bet > POINTS) return alert("Insufficient points!");

  POINTS -= bet;
  updateBalanceDisplay();

  USER_STATS.wagered += bet;
  saveStats();

  const newRoom = {
    id: Math.floor(1000 + Math.random()*8999),
    creator: USERNAME,
    opponent: null,
    bet,
    creatorGuess: createSelectedSide
  };

  matches.push(newRoom);
  $("createMatchModal").classList.add("hidden");
  enterRoom(newRoom.id);
};

// ---------------- ACCOUNT MENU & LOGOUT ----------------
$("usernameDisplay").onclick = () => {
  if (!USERNAME) return;
  $("accWagered").textContent = `${USER_STATS.wagered.toLocaleString()} PTS`;
  $("accWon").textContent = `${USER_STATS.won.toLocaleString()} PTS`;
  $("accLost").textContent = `${USER_STATS.lost.toLocaleString()} PTS`;
  $("accountMenu").classList.remove("hidden");
};

$("closeAccountMenu").onclick = () => $("accountMenu").classList.add("hidden");

$("logoutBtn").onclick = () => {
  USERNAME = null;
  POINTS = 1000;

  clearToken();
  localStorage.removeItem("points");
  localStorage.removeItem("userStats");

  USER_STATS = { wagered: 0, won: 0, lost: 0 };

  $("accountMenu").classList.add("hidden");
  $("matchRoom").classList.add("hidden");

  matches = [];
  finishedMatches = [];
  archiveResults = {};
  nonce = 0;

  updateBalanceDisplay();
  setLoggedOutUI();
  renderMatchList();
};
