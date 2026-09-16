import { DurableObject } from "cloudflare:workers";

const DEFAULT_STATE = Object.freeze({ currentPark: "mk", graphics: [], video: null, text: null, rideWait: null, weather: null, radar: null, rideSettings: {}, lineTimer: { name: "", rideKey: "", park: "mk", reportedWait: null, reportedStatus: "", running: false, visible: false, startedAt: null, accumulatedMs: 0, stoppedAt: null }, trivia: { visible: false, phase: "idle", questionId: "", questionNumber: 0, question: "", answers: { A: "", B: "", C: "", D: "" }, correct: "", explanation: "", answerCount: 0, leaderboard: [] }, updatedAt: null });
const MAX_UPLOAD_BYTES = 75 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
  "video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/webm"
]);

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function isAuthorized(request, env) {
  const supplied = request.headers.get("X-Control-Key") || "";
  return Boolean(env.CONTROL_KEY) && supplied === env.CONTROL_KEY;
}

function safeName(name) {
  const cleaned = String(name || "file")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return cleaned || "file";
}

function encodeKeyPath(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function mediaKind(type = "") {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "other";
}

const PARK_KEYS = ["mk","epcot","hs","ak","springs"];
function normalizePark(value) {
  const p = String(value || "").toLowerCase();
  return PARK_KEYS.includes(p) ? p : "mk";
}
function sanitizeTimerName(value) { return String(value || "").trim().slice(0, 80); }
function normalizeTimer(timer) {
  return {
    name: sanitizeTimerName(timer?.name || ""),
    rideKey: String(timer?.rideKey || "").slice(0, 120),
    park: normalizePark(timer?.park || "mk"),
    reportedWait: Number.isFinite(Number(timer?.reportedWait)) ? Math.max(0, Number(timer.reportedWait)) : null,
    reportedStatus: String(timer?.reportedStatus || "").slice(0, 24),
    running: Boolean(timer?.running),
    visible: Boolean(timer?.visible),
    startedAt: Number.isFinite(Number(timer?.startedAt)) ? Number(timer.startedAt) : null,
    accumulatedMs: Math.max(0, Number(timer?.accumulatedMs || 0)),
    stoppedAt: Number.isFinite(Number(timer?.stoppedAt)) ? Number(timer.stoppedAt) : null
  };
}
function normalizeRideSettings(value) {
  const src = value && typeof value === "object" ? value : {};
  const out = {};
  for (const park of PARK_KEYS) {
    const parkSrc = src[park] && typeof src[park] === "object" ? src[park] : {};
    const parkOut = {};
    let count = 0;
    for (const [rawKey, rawSetting] of Object.entries(parkSrc)) {
      if (count >= 500) break;
      const key = String(rawKey || "").slice(0, 140);
      if (!key || !rawSetting || typeof rawSetting !== "object") continue;
      parkOut[key] = {
        displayName: sanitizeTimerName(rawSetting.displayName || ""),
        omitted: Boolean(rawSetting.omitted)
      };
      count++;
    }
    if (Object.keys(parkOut).length) out[park] = parkOut;
  }
  return out;
}

function normalizeTrivia(value) {
  const src = value && typeof value === "object" ? value : {};
  const answers = src.answers && typeof src.answers === "object" ? src.answers : {};
  const phase = ["idle","question","open","closed","revealed","leaderboard"].includes(String(src.phase || "")) ? String(src.phase) : "idle";
  return {
    visible: Boolean(src.visible),
    phase,
    questionId: String(src.questionId || "").slice(0, 120),
    questionNumber: Math.max(0, Math.floor(Number(src.questionNumber || 0))),
    question: String(src.question || "").slice(0, 500),
    answers: {
      A: String(answers.A || "").slice(0, 240),
      B: String(answers.B || "").slice(0, 240),
      C: String(answers.C || "").slice(0, 240),
      D: String(answers.D || "").slice(0, 240)
    },
    correct: phase === "revealed" ? String(src.correct || "").toUpperCase().slice(0, 1) : "",
    explanation: phase === "revealed" ? String(src.explanation || "").slice(0, 500) : "",
    answerCount: Math.max(0, Math.floor(Number(src.answerCount || 0))),
    leaderboard: Array.isArray(src.leaderboard) ? src.leaderboard.slice(0, 20).map(row => ({
      rank: Math.max(1, Math.floor(Number(row?.rank || 1))),
      name: String(row?.name || "").slice(0, 100),
      score: Math.max(0, Math.floor(Number(row?.score || 0))),
      correct: Math.max(0, Math.floor(Number(row?.correct || 0))),
      answered: Math.max(0, Math.floor(Number(row?.answered || 0)))
    })) : []
  };
}


function normalizeTriviaScores(value) {
  const src = value && typeof value === "object" ? value : {};
  const out = {};
  let count = 0;
  for (const [rawUserId, raw] of Object.entries(src)) {
    if (count >= 10000) break;
    const userId = String(rawUserId || "").trim().slice(0, 160);
    if (!userId || !raw || typeof raw !== "object") continue;
    out[userId] = {
      userId,
      name: String(raw.name || "Viewer").trim().slice(0, 100) || "Viewer",
      score: Math.max(0, Math.floor(Number(raw.score || 0))),
      correct: Math.max(0, Math.floor(Number(raw.correct || 0))),
      answered: Math.max(0, Math.floor(Number(raw.answered || 0)))
    };
    count++;
  }
  return out;
}

function buildTriviaLeaderboard(scores, limit = 20) {
  const rows = Object.values(normalizeTriviaScores(scores)).sort((a, b) =>
    (b.score - a.score) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  let previousScore = null;
  let previousRank = 0;
  return rows.slice(0, Math.max(1, Math.min(100, Number(limit || 20)))).map((row, index) => {
    const rank = previousScore === row.score ? previousRank : index + 1;
    previousScore = row.score;
    previousRank = rank;
    return { rank, name: row.name, score: row.score, correct: row.correct, answered: row.answered };
  });
}

function getTriviaViewerScore(scores, userId) {
  const normalized = normalizeTriviaScores(scores);
  const viewer = normalized[userId];
  if (!viewer) return { userId, name: "", score: 0, correct: 0, answered: 0, rank: null, totalPlayers: Object.keys(normalized).length };
  const ordered = Object.values(normalized).sort((a, b) =>
    (b.score - a.score) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  let previousScore = null;
  let previousRank = 0;
  let rank = null;
  for (let i = 0; i < ordered.length; i++) {
    const rowRank = previousScore === ordered[i].score ? previousRank : i + 1;
    previousScore = ordered[i].score;
    previousRank = rowRank;
    if (ordered[i].userId === userId) { rank = rowRank; break; }
  }
  return { ...viewer, rank, totalPlayers: ordered.length };
}

function stateWithDefaults(state) {
  const s = state || {};
  return { ...DEFAULT_STATE, ...s, currentPark: normalizePark(s.currentPark || DEFAULT_STATE.currentPark), rideSettings: normalizeRideSettings(s.rideSettings), lineTimer: normalizeTimer(s.lineTimer || DEFAULT_STATE.lineTimer), trivia: normalizeTrivia(s.trivia || DEFAULT_STATE.trivia) };
}

export class OverlayRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const role = request.headers.get("X-Overlay-Role") || "overlay";
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server, [role]);
      const state = stateWithDefaults(await this.ctx.storage.get("state"));
      server.send(JSON.stringify({ type: "state", state }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith("/command") && request.method === "POST") {
      return this.handleCommand(await request.json());
    }

    if (url.pathname.endsWith("/state") && request.method === "GET") {
      return json(stateWithDefaults(await this.ctx.storage.get("state")));
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws, message) {
    let data;
    try { data = JSON.parse(message); } catch { return; }
    const role = this.ctx.getTags(ws)[0] || "overlay";

    if (role === "control") {
      await this.handleCommand(data);
      return;
    }

    if (role === "overlay" && data?.type === "event") {
      const current = stateWithDefaults(await this.ctx.storage.get("state"));

      if (data.event === "videoEnded") {
        if (current.video && (!data.src || current.video.src === data.src)) {
          const next = { ...current, video: null, updatedAt: new Date().toISOString() };
          await this.persistAndBroadcast(next);
        }
        return;
      }

      if (data.event === "imageExpired") {
        const id = String(data.id || "");
        const src = String(data.src || "");
        const graphics = Array.isArray(current.graphics) ? current.graphics : [];
        const filtered = graphics.filter(g =>
          !((id && String(g?.id || "") === id) || (src && String(g?.src || "") === src))
        );
        if (filtered.length !== graphics.length) {
          const next = { ...current, graphics: filtered, updatedAt: new Date().toISOString() };
          await this.persistAndBroadcast(next);
        }
        return;
      }
    }
  }

  async persistAndBroadcast(state) {
    await this.ctx.storage.put("state", state);
    const payload = JSON.stringify({ type: "state", state });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); } catch {}
    }
  }

  async finalizeTriviaQuestion(trivia) {
    const privateTrivia = await this.ctx.storage.get("triviaPrivate");
    const questionId = String(trivia?.questionId || privateTrivia?.questionId || "").slice(0, 120);
    if (!questionId || !privateTrivia?.correct || String(privateTrivia.questionId || "") !== questionId) {
      return { scores: normalizeTriviaScores(await this.ctx.storage.get("triviaScores")), finalized: false };
    }

    const finalizedStored = await this.ctx.storage.get("triviaFinalized");
    const finalizedMap = finalizedStored && typeof finalizedStored === "object" ? finalizedStored : {};
    const existingScores = normalizeTriviaScores(await this.ctx.storage.get("triviaScores"));
    if (finalizedMap[questionId]) return { scores: existingScores, finalized: false };

    const storedAnswers = await this.ctx.storage.get("triviaAnswers");
    const answerMap = storedAnswers && typeof storedAnswers === "object" ? storedAnswers : {};
    const correctChoice = String(privateTrivia.correct || "").toUpperCase().slice(0, 1);
    const scores = { ...existingScores };

    for (const answer of Object.values(answerMap)) {
      if (!answer || String(answer.questionId || "") !== questionId) continue;
      const userId = String(answer.userId || "").trim().slice(0, 160);
      if (!userId) continue;
      const prior = scores[userId] || { userId, name: "Viewer", score: 0, correct: 0, answered: 0 };
      const isCorrect = String(answer.choice || "").toUpperCase() === correctChoice;
      scores[userId] = {
        userId,
        name: String(answer.name || prior.name || "Viewer").trim().slice(0, 100) || "Viewer",
        score: prior.score + (isCorrect ? 1 : 0),
        correct: prior.correct + (isCorrect ? 1 : 0),
        answered: prior.answered + 1
      };
    }

    finalizedMap[questionId] = Date.now();
    await this.ctx.storage.put("triviaScores", scores);
    await this.ctx.storage.put("triviaFinalized", finalizedMap);
    return { scores, finalized: true };
  }

  async handleCommand(command) {
    const current = stateWithDefaults(await this.ctx.storage.get("state"));
    let next = { ...current };

    switch (command.action) {
      case "showImage": {
        next.text = null;
        next.video = null;
        const image = {
          id: String(command.id || crypto.randomUUID()),
          src: String(command.src || ""),
          duration: Math.max(0, Number(command.duration || 0)),
          fit: command.fit || "contain",
          animation: ["none","pulse","jiggle","bounce","wiggle","float","heartbeat","spin"].includes(String(command.animation || "").toLowerCase()) ? String(command.animation).toLowerCase() : "none",
          position: command.position || "center",
          size: Math.max(5, Math.min(100, Number(command.size || 40)))
        };
        const currentGraphics = Array.isArray(current.graphics)
          ? current.graphics.filter(g => g && g.src)
          : (current.graphic ? [{ ...current.graphic, id: current.graphic.id || crypto.randomUUID(), size: 40 }] : []);
        const stayOn = currentGraphics.filter(g =>
          Number(g.duration || 0) === 0 && g.src !== image.src
        );
        // Stay-on graphics remain. A temporary graphic replaces only other temporary graphics.
        // A new stay-on graphic layers with the existing stay-on graphics.
        next.graphics = image.duration === 0
          ? [...stayOn, image].slice(-12)
          : [...stayOn, image].slice(-12);
        delete next.graphic;
        break;
      }
      case "hideImage": {
        const currentGraphics = Array.isArray(current.graphics)
          ? current.graphics
          : (current.graphic ? [{ ...current.graphic, id: current.graphic.id || "legacy" }] : []);
        const targetSrc = String(command.src || "");
        const targetId = String(command.id || "");
        next.graphics = (targetSrc || targetId)
          ? currentGraphics.filter(g => !((targetSrc && g?.src === targetSrc) || (targetId && g?.id === targetId)))
          : [];
        delete next.graphic;
        break;
      }
      case "playVideo":
        next.text = null;
        next.graphics = [];
        delete next.graphic;
        next.video = {
          src: String(command.src || ""),
          fit: command.fit || "contain",
          position: command.position || "center",
          volume: Math.max(0, Math.min(1, Number(command.volume ?? 1)))
        };
        break;
      case "stopVideo": next.video = null; break;
      case "showText":
        // Text is independent from the image layer. Keep all active graphics.
        // Video behavior remains unchanged for now.
        next.video = null;
        next.text = {
          value: String(command.value || "").slice(0, 300),
          position: command.position === "top" ? "top" : "bottom",
          color: /^#[0-9a-fA-F]{6}$/.test(String(command.color || "")) ? command.color : "#ffffff",
          size: Math.max(18, Math.min(120, Number(command.size || 48))),
          font: ["system","arial","georgia","impact","comic"].includes(String(command.font || "")) ? String(command.font) : "system",
          scroll: Boolean(command.scroll),
          scrollSeconds: Math.max(5, Math.min(40, Number(command.scrollSeconds || 12)))
        };
        break;
      case "hideText": next.text = null; break;
      case "setCurrentPark":
        next.currentPark = normalizePark(command.park);
        break;
      case "showRideWait":
      case "showRideWaitCard":
      case "showRideWaitTicker": {
        const explicitTicker = command.action === "showRideWaitTicker";
        const explicitCard = command.action === "showRideWaitCard";
        const requestedMode = explicitTicker ? "ticker" : explicitCard ? "card" :
          (["card","ticker"].includes(String(command.displayMode || "").toLowerCase())
            ? String(command.displayMode).toLowerCase()
            : "card");

        next.rideWait = {
          parkKey: normalizePark(command.parkKey || next.currentPark),
          park: (() => {
            const selected = normalizePark(command.parkKey || next.currentPark);
            const ids = { mk: 6, epcot: 5, hs: 7, ak: 8 };
            return ids[selected] || 6;
          })(),
          position: ["center","top","bottom","left","right","top-left","top-right","bottom-left","bottom-right"].includes(String(command.position || "")) ? String(command.position) : "bottom",
          size: Math.max(2, Math.min(75, Number(command.size || 20))),
          displayMode: requestedMode,
          ticker: requestedMode === "ticker",
          cycle: Math.max(3, Math.min(120, Number(command.cycle || 10)))
        };
        break;
      }
      case "hideRideWait": next.rideWait = null; break;
      case "showWeather":
        next.weather = {
          park: normalizePark(command.park || next.currentPark),
          position: ["center","top","bottom","left","right","top-left","top-right","bottom-left","bottom-right"].includes(String(command.position || "")) ? String(command.position) : "top-right",
          size: Math.max(10, Math.min(100, Number(command.size || 40))),
          unit: String(command.unit || "f").toLowerCase() === "c" ? "c" : "f"
        };
        break;
      case "hideWeather": next.weather = null; break;
      case "showRadar":
        next.radar = {
          park: normalizePark(command.park || next.currentPark),
          position: ["center","top","bottom","left","right","top-left","top-right","bottom-left","bottom-right"].includes(String(command.position || "")) ? String(command.position) : "center",
          size: Math.max(20, Math.min(100, Number(command.size || 55))),
          zoom: [5,6,7].includes(Number(command.zoom)) ? Number(command.zoom) : 6
        };
        break;
      case "hideRadar": next.radar = null; break;
      case "rideSettingSet": {
        const park = normalizePark(command.park || next.currentPark);
        const key = String(command.key || "").slice(0, 140);
        if (!key) return json({ ok: false, error: "Missing ride key" }, { status: 400 });
        const all = normalizeRideSettings(next.rideSettings);
        const parkSettings = { ...(all[park] || {}) };
        parkSettings[key] = {
          displayName: sanitizeTimerName(command.displayName || ""),
          omitted: Boolean(command.omitted)
        };
        next.rideSettings = { ...all, [park]: parkSettings };
        break;
      }
      case "rideSettingReset": {
        const park = normalizePark(command.park || next.currentPark);
        const key = String(command.key || "").slice(0, 140);
        const all = normalizeRideSettings(next.rideSettings);
        const parkSettings = { ...(all[park] || {}) };
        delete parkSettings[key];
        const updated = { ...all };
        if (Object.keys(parkSettings).length) updated[park] = parkSettings;
        else delete updated[park];
        next.rideSettings = updated;
        break;
      }
      case "timerConfigure": {
        const t = normalizeTimer(next.lineTimer);
        if (!t.running) {
          next.lineTimer = {
            ...t,
            name: sanitizeTimerName(command.name || ""),
            rideKey: String(command.rideKey || "").slice(0, 120),
            park: normalizePark(command.park || next.currentPark),
            reportedWait: null,
            reportedStatus: ""
          };
        }
        break;
      }
      case "timerSetName":
        next.lineTimer = { ...normalizeTimer(next.lineTimer), name: sanitizeTimerName(command.name) };
        break;
      case "timerStart": {
        const t = normalizeTimer(next.lineTimer);
        if (t.running) next.lineTimer = t;
        else next.lineTimer = {
          ...t,
          name: sanitizeTimerName(command.name || t.name || ""),
          rideKey: String(command.rideKey || t.rideKey || "").slice(0, 120),
          park: normalizePark(command.park || t.park || next.currentPark),
          reportedWait: Number.isFinite(Number(command.reportedWait)) ? Math.max(0, Number(command.reportedWait)) : null,
          reportedStatus: String(command.reportedStatus || "").slice(0, 24),
          running: true,
          startedAt: Date.now(),
          stoppedAt: null
        };
        break;
      }
      case "timerStop": {
        const t = normalizeTimer(next.lineTimer);
        if (t.running && t.startedAt) {
          const now = Date.now();
          next.lineTimer = { ...t, running: false, startedAt: null, accumulatedMs: t.accumulatedMs + Math.max(0, now - t.startedAt), stoppedAt: now };
        } else next.lineTimer = t;
        break;
      }
      case "timerReset": {
        const t = normalizeTimer(next.lineTimer);
        next.lineTimer = { ...t, reportedWait: null, reportedStatus: "", running: false, startedAt: null, accumulatedMs: 0, stoppedAt: null };
        break;
      }
      case "timerShow": next.lineTimer = { ...normalizeTimer(next.lineTimer), visible: true }; break;
      case "timerHide": next.lineTimer = { ...normalizeTimer(next.lineTimer), visible: false }; break;
      case "triviaSetQuestion": {
        const question = String(command.question || "").trim().slice(0, 500);
        const answers = command.answers && typeof command.answers === "object" ? command.answers : {};
        const correct = String(command.correct || "").trim().toUpperCase();
        if (!question) return json({ ok: false, error: "Missing trivia question" }, { status: 400 });
        if (!["A","B","C","D"].includes(correct)) return json({ ok: false, error: "Correct answer must be A, B, C, or D" }, { status: 400 });
        for (const key of ["A","B","C","D"]) {
          if (!String(answers[key] || "").trim()) return json({ ok: false, error: `Missing answer ${key}` }, { status: 400 });
        }
        const questionId = String(command.questionId || crypto.randomUUID()).slice(0, 120);
        await this.ctx.storage.put("triviaPrivate", {
          questionId,
          correct,
          explanation: String(command.explanation || "").slice(0, 500)
        });
        await this.ctx.storage.delete("triviaAnswers");
        next.trivia = {
          visible: true,
          phase: "question",
          questionId,
          questionNumber: Math.max(0, Math.floor(Number(command.questionNumber || 0))),
          question,
          answers: {
            A: String(answers.A).slice(0, 240),
            B: String(answers.B).slice(0, 240),
            C: String(answers.C).slice(0, 240),
            D: String(answers.D).slice(0, 240)
          },
          correct: "",
          explanation: "",
          answerCount: 0,
          leaderboard: normalizeTrivia(current.trivia).leaderboard
        };
        break;
      }
      case "triviaOpen":
        if (!normalizeTrivia(current.trivia).question) return json({ ok: false, error: "Set a trivia question first" }, { status: 400 });
        next.trivia = { ...normalizeTrivia(current.trivia), visible: true, phase: "open", correct: "", explanation: "" };
        break;
      case "triviaClose": {
        const trivia = normalizeTrivia(current.trivia);
        const result = await this.finalizeTriviaQuestion(trivia);
        next.trivia = { ...trivia, visible: true, phase: "closed", correct: "", explanation: "", leaderboard: buildTriviaLeaderboard(result.scores) };
        break;
      }
      case "triviaReveal": {
        const trivia = normalizeTrivia(current.trivia);
        const privateTrivia = await this.ctx.storage.get("triviaPrivate");
        if (!privateTrivia?.correct) return json({ ok: false, error: "No correct answer is stored for this question" }, { status: 400 });
        const result = await this.finalizeTriviaQuestion(trivia);
        next.trivia = {
          ...trivia,
          visible: true,
          phase: "revealed",
          correct: String(privateTrivia.correct || "").toUpperCase().slice(0, 1),
          explanation: String(privateTrivia.explanation || "").slice(0, 500),
          leaderboard: buildTriviaLeaderboard(result.scores)
        };
        break;
      }
      case "triviaShowLeaderboard": {
        const scores = normalizeTriviaScores(await this.ctx.storage.get("triviaScores"));
        next.trivia = { ...normalizeTrivia(current.trivia), visible: true, phase: "leaderboard", correct: "", explanation: "", leaderboard: buildTriviaLeaderboard(scores) };
        break;
      }
      case "triviaHide":
        next.trivia = { ...normalizeTrivia(current.trivia), visible: false };
        break;
      case "triviaAnswer": {
        const trivia = normalizeTrivia(current.trivia);
        if (trivia.phase !== "open") return json({ ok: false, error: "Trivia answers are closed" }, { status: 409 });
        const userId = String(command.userId || "").trim().slice(0, 160);
        const name = String(command.name || command.displayName || "").trim().slice(0, 100);
        const choice = String(command.choice || command.answer || "").trim().toUpperCase();
        if (!userId) return json({ ok: false, error: "Missing viewer userId" }, { status: 400 });
        if (!["A","B","C","D"].includes(choice)) return json({ ok: false, error: "Answer must be A, B, C, or D" }, { status: 400 });
        const stored = await this.ctx.storage.get("triviaAnswers");
        const answerMap = stored && typeof stored === "object" ? stored : {};
        if (answerMap[userId]) return json({ ok: false, error: "Viewer already answered", duplicate: true }, { status: 409 });
        answerMap[userId] = { userId, name, choice, answeredAt: Date.now(), questionId: trivia.questionId };
        await this.ctx.storage.put("triviaAnswers", answerMap);
        next.trivia = { ...trivia, answerCount: Object.keys(answerMap).length };
        break;
      }
      case "triviaGetScore": {
        const userId = String(command.userId || "").trim().slice(0, 160);
        if (!userId) return json({ ok: false, error: "Missing viewer userId" }, { status: 400 });
        const scores = normalizeTriviaScores(await this.ctx.storage.get("triviaScores"));
        return json({ ok: true, viewer: getTriviaViewerScore(scores, userId) });
      }
      case "triviaReset":
        await this.ctx.storage.delete("triviaPrivate");
        await this.ctx.storage.delete("triviaAnswers");
        await this.ctx.storage.delete("triviaScores");
        await this.ctx.storage.delete("triviaFinalized");
        next.trivia = { ...DEFAULT_STATE.trivia };
        break;
      case "clear": next = { ...DEFAULT_STATE, currentPark: normalizePark(next.currentPark), rideSettings: normalizeRideSettings(next.rideSettings), trivia: normalizeTrivia(next.trivia) }; break;
      default: return json({ ok: false, error: "Unknown action" }, { status: 400 });
    }

    next.updatedAt = new Date().toISOString();
    await this.persistAndBroadcast(next);
    return json({ ok: true, state: next });
  }
}

async function listMedia(env) {
  const result = await env.MEDIA.list({ limit: 500, include: ["httpMetadata", "customMetadata"] });
  const items = result.objects.map(obj => {
    const type = obj.httpMetadata?.contentType || obj.customMetadata?.type || "application/octet-stream";
    return {
      key: obj.key,
      name: obj.customMetadata?.displayName || obj.key.split("/").pop(),
      type,
      kind: mediaKind(type),
      size: obj.size,
      uploaded: obj.uploaded?.toISOString?.() || null,
      url: `/media/${encodeKeyPath(obj.key)}`
    };
  }).sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)));
  return json({ items, truncated: result.truncated });
}

async function uploadMedia(request, env) {
  const url = new URL(request.url);
  const displayName = safeName(url.searchParams.get("name") || request.headers.get("X-File-Name") || "file");
  const contentType = (request.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const contentLength = Number(request.headers.get("content-length") || 0);

  if (!ALLOWED_TYPES.has(contentType)) {
    return json({ ok: false, error: `Unsupported file type: ${contentType}` }, { status: 415 });
  }
  if (contentLength > MAX_UPLOAD_BYTES) {
    return json({ ok: false, error: "File is larger than the 75 MB mobile upload limit." }, { status: 413 });
  }
  if (!request.body) return json({ ok: false, error: "Missing file body" }, { status: 400 });

  const kind = mediaKind(contentType);
  const key = `${kind}s/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${displayName}`;
  await env.MEDIA.put(key, request.body, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { displayName, type: contentType }
  });
  return json({ ok: true, key, name: displayName, url: `/media/${encodeKeyPath(key)}` });
}

async function deleteMedia(request, env) {
  const { key } = await request.json();
  if (!key || typeof key !== "string") return json({ ok: false, error: "Missing key" }, { status: 400 });
  await env.MEDIA.delete(key);
  return json({ ok: true });
}

async function renameMedia(request, env) {
  const { key, name } = await request.json();
  const newDisplayName = safeName(name);
  if (!key || !newDisplayName) return json({ ok: false, error: "Missing key or name" }, { status: 400 });

  const object = await env.MEDIA.get(key);
  if (!object || !("body" in object)) return json({ ok: false, error: "Media not found" }, { status: 404 });

  // Keep the storage key stable so active overlay URLs never break; rename display metadata only.
  await env.MEDIA.put(key, object.body, {
    httpMetadata: object.httpMetadata,
    customMetadata: { ...(object.customMetadata || {}), displayName: newDisplayName }
  });
  return json({ ok: true, key, name: newDisplayName });
}

async function serveMedia(request, env, key) {
  if (!key) return new Response("Not found", { status: 404 });
  const object = await env.MEDIA.get(key, { onlyIf: request.headers, range: request.headers });
  if (object === null) return new Response("Media not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("access-control-allow-origin", "*");

  if (!("body" in object)) return new Response(null, { status: 412, headers });

  let status = 200;
  if (request.headers.has("range") && object.range) {
    status = 206;
    const offset = object.range.offset || 0;
    const length = object.range.length || object.size;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
  } else {
    headers.set("content-length", String(object.size));
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
}


async function serveRideWaitData(url) {
  const park = Number(url.searchParams.get("park") || 6);
  if (![5,6,7,8].includes(park)) {
    return json({ ok: false, error: "Unsupported park" }, { status: 400 });
  }

  try {
    const upstream = await fetch(`https://queue-times.com/parks/${park}/queue_times.json`, {
      headers: { "accept": "application/json" }
    });
    if (!upstream.ok) throw new Error(`Queue-Times HTTP ${upstream.status}`);

    const data = await upstream.json();
    return json(data, {
      headers: {
        "cache-control": "public, max-age=60"
      }
    });
  } catch (error) {
    return json(
      { ok: false, error: "Unable to load Queue-Times data" },
      { status: 502 }
    );
  }
}


const WEATHER_PARKS = {
  mk: { label: "Magic Kingdom", latitude: 28.417663, longitude: -81.581212 },
  epcot: { label: "EPCOT", latitude: 28.374694, longitude: -81.549404 },
  hs: { label: "Disney's Hollywood Studios", latitude: 28.357529, longitude: -81.558271 },
  ak: { label: "Disney's Animal Kingdom", latitude: 28.359566, longitude: -81.591172 },
  springs: { label: "Disney Springs", latitude: 28.371496, longitude: -81.519005 }
};

async function serveWeatherData(url) {
  const parkKey = String(url.searchParams.get("park") || "mk").toLowerCase();
  const unit = String(url.searchParams.get("unit") || "f").toLowerCase() === "c" ? "c" : "f";
  const park = WEATHER_PARKS[parkKey] || WEATHER_PARKS.mk;

  const params = new URLSearchParams({
    latitude: String(park.latitude),
    longitude: String(park.longitude),
    current: ["temperature_2m","apparent_temperature","precipitation","weather_code"].join(","),
    hourly: "precipitation_probability",
    daily: "precipitation_probability_max",
    temperature_unit: unit === "c" ? "celsius" : "fahrenheit",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: "1"
  });

  try {
    const upstream = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      headers: { "accept": "application/json" }
    });
    if (!upstream.ok) throw new Error(`Open-Meteo HTTP ${upstream.status}`);
    const data = await upstream.json();
    return json({ ...data, overlay_location_name: park.label }, {
      headers: { "cache-control": "public, max-age=60" }
    });
  } catch (error) {
    return json({ ok: false, error: "Unable to load weather data" }, { status: 502 });
  }
}


async function serveRadarData() {
  try {
    const upstream = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
      headers: { "accept": "application/json" }
    });
    if (!upstream.ok) throw new Error(`RainViewer HTTP ${upstream.status}`);
    const data = await upstream.json();
    const past = Array.isArray(data?.radar?.past) ? data.radar.past.slice(-6) : [];
    return json({
      generated: data.generated || null,
      host: data.host || "https://tilecache.rainviewer.com",
      frames: past.map(f => ({ time: f.time, path: f.path }))
    }, {
      headers: { "cache-control": "public, max-age=120" }
    });
  } catch (error) {
    return json({ ok: false, error: "Unable to load radar metadata" }, { status: 502 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/media/")) {
      const key = url.pathname.slice(7).split("/").map(decodeURIComponent).join("/");
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      return serveMedia(request, env, key);
    }

    if (url.pathname.startsWith("/ws/")) {
      const roomName = decodeURIComponent(url.pathname.slice(4)) || "default";
      const role = url.searchParams.get("role") || "overlay";
      if (role === "control") {
        const key = url.searchParams.get("key") || "";
        if (!env.CONTROL_KEY || key !== env.CONTROL_KEY) return new Response("Unauthorized", { status: 401 });
      }
      const id = env.OVERLAY_ROOMS.idFromName(roomName);
      const stub = env.OVERLAY_ROOMS.get(id);
      const headers = new Headers(request.headers);
      headers.set("X-Overlay-Role", role === "control" ? "control" : "overlay");
      return stub.fetch(new Request(request, { headers }));
    }

    if (url.pathname === "/ride-waits-data" && request.method === "GET") {
      return serveRideWaitData(url);
    }

    if (url.pathname === "/weather-data" && request.method === "GET") {
      return serveWeatherData(url);
    }

    if (url.pathname === "/radar-data" && request.method === "GET") {
      return serveRadarData();
    }

    if (url.pathname.startsWith("/api/media/")) {
      if (!isAuthorized(request, env)) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
      const action = url.pathname.slice("/api/media/".length);
      if (action === "list" && request.method === "GET") return listMedia(env);
      if (action === "upload" && request.method === "POST") return uploadMedia(request, env);
      if (action === "delete" && request.method === "POST") return deleteMedia(request, env);
      if (action === "rename" && request.method === "POST") return renameMedia(request, env);
      return json({ ok: false, error: "Not found" }, { status: 404 });
    }

    if (url.pathname.startsWith("/api/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const roomName = decodeURIComponent(parts[1] || "default");
      const action = parts[2] || "";
      if (!isAuthorized(request, env)) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
      const id = env.OVERLAY_ROOMS.idFromName(roomName);
      const stub = env.OVERLAY_ROOMS.get(id);
      if (action === "command") return stub.fetch(new Request("https://room/command", { method: request.method, headers: request.headers, body: request.body }));
      if (action === "state") return stub.fetch("https://room/state");
      return json({ ok: false, error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
