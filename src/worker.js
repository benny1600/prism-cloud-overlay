import { DurableObject } from "cloudflare:workers";

const DEFAULT_STATE = Object.freeze({ graphics: [], video: null, text: null, updatedAt: null });
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
      const state = (await this.ctx.storage.get("state")) || { ...DEFAULT_STATE };
      server.send(JSON.stringify({ type: "state", state }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith("/command") && request.method === "POST") {
      return this.handleCommand(await request.json());
    }

    if (url.pathname.endsWith("/state") && request.method === "GET") {
      return json((await this.ctx.storage.get("state")) || { ...DEFAULT_STATE });
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
      const current = (await this.ctx.storage.get("state")) || { ...DEFAULT_STATE };

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

  async handleCommand(command) {
    const current = (await this.ctx.storage.get("state")) || { ...DEFAULT_STATE };
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
          position: command.position || "center",
          size: Math.max(10, Math.min(100, Number(command.size || 40)))
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
        next.graphics = [];
        delete next.graphic;
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
      case "clear": next = { ...DEFAULT_STATE }; break;
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
