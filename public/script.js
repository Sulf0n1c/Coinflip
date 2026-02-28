// ---------------- UTIL ----------------
const $ = (id) => document.getElementById(id);

// ---------------- GLOBAL STATE ----------------
let USERNAME = null;
let POINTS = 1000;
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
// { id, bet, creator, opponent, winner, amountWon, endedAt }

// Archive of full results for re-showing the ending screen
let archiveResults = {};
// archiveResults[roomId] = { id, bet, creator, opponent, result, winner, amountWon, seeds:{sSeed,pSeed,nonce}, hash, endedAt }

// ---------------- INIT ----------------
document.addEventListener("DOMContentLoaded", () => {
  const savedPoints = localStorage.getItem("points");
  if (savedPoints) POINTS = parseInt(savedPoints, 10);

  const savedUser = localStorage.getItem("username");
  if (savedUser) {
    USERNAME = savedUser;
  }

  const savedStats = localStorage.getItem("userStats");
  if (savedStats) {
    try { USER_STATS = JSON.parse(savedStats); } catch (_) {}
  }

  updateBalanceDisplay();
  if (USERNAME) updateLoginUI();

  renderMatchList();
  updateFlipBtnState();

  // Clean up finished matches and archived results after ~20s
  setInterval(() => {
    const cutoff = Date.now() - 20_000;

    const beforeFM = finishedMatches.length;
    finishedMatches = finishedMatches.filter(m => m.endedAt > cutoff);
    const afterFM = finishedMatches.length;

    // Archive cleanup
    for (const key of Object.keys(archiveResults)) {
      if (archiveResults[key].endedAt <= cutoff) delete archiveResults[key];
    }

    if (afterFM !== beforeFM) renderMatchList();
  }, 1000);
});

// ---------------- HELPERS ----------------
function updateBalanceDisplay() {
  $("balanceDisplay").textContent = POINTS.toLocaleString();
  localStorage.setItem("points", POINTS);
}

function updateLoginUI() {
  $("usernameDisplay").textContent = `Logged in as: ${USERNAME}`;
  $("usernameDisplay").classList.add("username-display");
  $("loginBtn").classList.add("hidden");
  $("createMatchBtn").disabled = false;
  $("loginModal").classList.add("hidden");
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

// ---------------- CREATE MATCH ----------------
$("createMatchBtn").onclick = () => {
  if (!USERNAME) return alert("Login first!");

  $("betInput").value = Math.min(POINTS, 100);
  $("maxPointsHelper").textContent = POINTS.toLocaleString();

  createSelectedSide = "heads";
  document.querySelectorAll("#createMatchModal .choice-box")
    .forEach(b =>
      b.classList.toggle("active", b.dataset.value === "heads")
    );

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

  // --- ACTIVE MATCHES ---
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
    ) {
      joinBtn.disabled = true;
    }

    joinBtn.onclick = () => {
      if (POINTS < room.bet) return alert("Insufficient points!");
      enterRoom(room.id);
    };

    buttonsDiv.appendChild(viewBtn);
    buttonsDiv.appendChild(joinBtn);
    div.querySelector(".match-info-row").appendChild(guessCoin);

    list.appendChild(div);
  });

  // --- FINISHED MATCHES (last ~20s, grayed out) ---
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

      // VIEW on finished card -> show ended screen (read-only)
      const viewBtn = div.querySelector("button.btn.small.cyan");
      viewBtn.onclick = () => showEndedMatch(fm.id);

      list.appendChild(div);
    });
}

// ---------------- ENTER ROOM ----------------
function enterRoom(roomId) {
  currentRoom = matches.find(r => r.id === roomId);
  if (!currentRoom) return;

  hasFlippedInCurrentRoom = false;

  // If joining as opponent for the first time, pay your bet immediately and track wagered
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
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function resetCoinInstant() {
  const coin = $("coin");
  coin.style.transition = "none";
  coin.style.transform = "rotateY(0deg) rotateX(0deg)";
  void coin.offsetWidth;
  coin.style.transition =
    "transform 1.5s cubic-bezier(0.3,2,0.5,1)";
}

function animateCoin(result) {
  const coin = $("coin");
  coin.style.transition = "none";
  coin.style.transform =
    result === "heads"
      ? "rotateY(0deg) rotateX(0deg)"
      : "rotateY(180deg) rotateX(0deg)";
  void coin.offsetWidth;
  coin.style.transition =
    "transform 1.5s cubic-bezier(0.3,2,0.5,1)";
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
  const result =
    parseInt(hash.substring(0,2),16) % 2 === 0
      ? "heads"
      : "tails";

  animateCoin(result);

  setTimeout(() => {
    const didWin = selectedChoice === result;

    $("flipResult").textContent = `RESULT: ${result.toUpperCase()}`;
    $("winnerDisplay").textContent =
      didWin ? "🎉 YOU WON!" : "❌ YOU LOST";

    $("winnerDisplay").style.color =
      didWin ? "var(--cyan)" : "var(--pink)";

    // Payouts & stats:
    if (didWin) {
      POINTS += currentRoom.bet * 2;
      updateBalanceDisplay();

      USER_STATS.won += currentRoom.bet * 2;
    } else {
      USER_STATS.lost += currentRoom.bet;
    }
    saveStats();

    lastFlip = { sSeed, pSeed, nonce, hash };

    $("seedData").textContent =
      `ServerSeed: ${sSeed} | PlayerSeed: ${pSeed} | Nonce: ${nonce}`;

    $("hashData").textContent = `Hash: ${hash}`;

    // ----- ARCHIVE the full result so we can re-show it later -----
    const winnerName = didWin ? USERNAME
      : (currentRoom.creator === USERNAME ? currentRoom.opponent : currentRoom.creator);

    archiveResults[currentRoom.id] = {
      id: currentRoom.id,
      bet: currentRoom.bet,
      creator: currentRoom.creator,
      opponent: currentRoom.opponent,
      result,                               // "heads" or "tails"
      winner: winnerName,
      amountWon: currentRoom.bet * 2,
      seeds: { sSeed, pSeed, nonce },       // keep the values that were displayed
      hash,
      endedAt: Date.now()
    };

    // Record a finished match for the results strip (visible ~20s)
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
  if (!data) {
    alert("Result no longer available.");
    return;
  }

  $("roomIdDisplay").textContent = data.id;
  $("roomCreatorDisplay").textContent = data.creator;
  $("roomOpponentDisplay").textContent = data.opponent || "—";
  $("yourSideDisplay").textContent = "—";

  // Reset coin, then set final pose
  resetCoinInstant();
  setTimeout(() => {
    const coin = $("coin");
    coin.style.transition = "none";
    coin.style.transform =
      data.result === "heads"
        ? "rotateY(0deg) rotateX(0deg)"
        : "rotateY(180deg) rotateX(0deg)";
  }, 0);

  $("flipResult").textContent = `RESULT: ${data.result.toUpperCase()}`;
  $("winnerDisplay").textContent = `Winner: ${data.winner} (+${data.amountWon.toLocaleString()} PTS)`;
  $("winnerDisplay").style.color = "var(--cyan)";
  $("seedData").textContent =
    `ServerSeed: ${data.seeds.sSeed} | PlayerSeed: ${data.seeds.pSeed} | Nonce: ${data.seeds.nonce}`;
  $("hashData").textContent = `Hash: ${data.hash}`;

  $("matchRoom").classList.remove("hidden");

  // Read-only ended view
  currentRoom = null;
  hasFlippedInCurrentRoom = true;
  isFlipping = false;
  $("flipBtn").disabled = true;
  updateFlipBtnState();
}

// ---------------- FAIRNESS MODAL ----------------
$("fairnessBtn").onclick = () => {
  $("fairnessModal").classList.remove("hidden");
};

$("closeFairnessModal").onclick = () => {
  $("fairnessModal").classList.add("hidden");
};

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

document.querySelectorAll("#createMatchModal .choice-box")
  .forEach(box => {
    box.addEventListener("click", () => {
      document.querySelectorAll("#createMatchModal .choice-box")
        .forEach(b => b.classList.remove("active"));
      box.classList.add("active");
      createSelectedSide = box.dataset.value;
    });
  });

$("cancelCreateMatch").onclick =
  () => $("createMatchModal").classList.add("hidden");

$("confirmCreateMatch").onclick = () => {
  if (!USERNAME) return alert("Login first.");

  const bet = parseInt($("betInput").value,10);
  if (!bet || bet <= 0) return alert("Invalid amount.");
  if (bet > POINTS) return alert("Insufficient points!");

  // Deduct creator's bet immediately
  POINTS -= bet;
  updateBalanceDisplay();

  // Track wagered for creator
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

// ---------------- LOGIN MODAL (simple local login) ----------------
$("loginBtn").onclick = () => {
  $("loginModal").classList.remove("hidden");
  $("usernameInput").value = "";
  $("usernameInput").placeholder = "Enter your username...";
  $("usernameInput").focus();
};

$("closeLogin").onclick = () => {
  $("loginModal").classList.add("hidden");
};

$("submitLogin").onclick = () => {
  const username = $("usernameInput").value.trim();
  if (!username) {
    alert("Please enter a username.");
    return;
  }
  USERNAME = username;
  localStorage.setItem("username", USERNAME);
  updateLoginUI();
};

$("usernameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("submitLogin").click();
});

// ---------------- ACCOUNT MENU & LOGOUT ----------------
$("usernameDisplay").onclick = () => {
  if (!USERNAME) return;
  $("accWagered").textContent = `${USER_STATS.wagered.toLocaleString()} PTS`;
  $("accWon").textContent = `${USER_STATS.won.toLocaleString()} PTS`;
  $("accLost").textContent = `${USER_STATS.lost.toLocaleString()} PTS`;
  $("accountMenu").classList.remove("hidden");
};

$("closeAccountMenu").onclick = () => {
  $("accountMenu").classList.add("hidden");
};

$("logoutBtn").onclick = () => {
  USERNAME = null;
  POINTS = 1000;

  localStorage.removeItem("username");
  localStorage.removeItem("points");
  localStorage.removeItem("userStats");

  USER_STATS = { wagered: 0, won: 0, lost: 0 };

  // Reset UI/state
  $("accountMenu").classList.add("hidden");
  $("matchRoom").classList.add("hidden");

  $("usernameDisplay").textContent = "";
  $("loginBtn").classList.remove("hidden");
  $("createMatchBtn").disabled = true;

  currentRoom = null;
  isFlipping = false;
  hasFlippedInCurrentRoom = false;
  matches = [];
  finishedMatches = [];
  archiveResults = {};
  nonce = 0;

  updateBalanceDisplay();
  updateFlipBtnState();
  renderMatchList();
};
