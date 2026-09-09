import { DurableObject } from "cloudflare:workers";

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

      // Send the current persistent state to newly connected viewers.
      const state = (await this.ctx.storage.get("state")) || {
        graphic: null,
        video: null,
        text: null,
        updatedAt: null
      };

      server.send(JSON.stringify({ type: "state", state }));

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname.endsWith("/command") && request.method === "POST") {
      const command = await request.json();
      return this.handleCommand(command);
    }

    if (url.pathname.endsWith("/state") && request.method === "GET") {
      const state = (await this.ctx.storage.get("state")) || {};
      return Response.json(state);
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws, message) {
    const tags = this.ctx.getTags(ws);
    const role = tags[0] || "overlay";

    // Overlay clients are receive-only.
    if (role !== "control") return;

    try {
      const command = JSON.parse(message);
      await this.handleCommand(command);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid command" }));
    }
  }

  async handleCommand(command) {
    const current = (await this.ctx.storage.get("state")) || {};
    let next = { ...current };

    switch (command.action) {
      case "showImage":
        next.graphic = {
          src: command.src,
          duration: Number(command.duration || 0),
          fit: command.fit || "contain"
        };
        break;

      case "hideImage":
        next.graphic = null;
        break;

      case "playVideo":
        next.video = {
          src: command.src,
          fit: command.fit || "contain",
          volume: Number(command.volume ?? 1)
        };
        break;

      case "stopVideo":
        next.video = null;
        break;

      case "showText":
        next.text = {
          value: String(command.value || ""),
          position: command.position || "bottom"
        };
        break;

      case "hideText":
        next.text = null;
        break;

      case "clear":
        next = { graphic: null, video: null, text: null };
        break;

      default:
        return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }

    next.updatedAt = new Date().toISOString();
    await this.ctx.storage.put("state", next);

    const payload = JSON.stringify({ type: "state", state: next });

    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); } catch {}
    }

    return Response.json({ ok: true, state: next });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/ws/")) {
      const roomName = decodeURIComponent(url.pathname.slice(4)) || "default";
      const role = url.searchParams.get("role") || "overlay";

      if (role === "control") {
        const key = url.searchParams.get("key") || "";
        if (!env.CONTROL_KEY || key !== env.CONTROL_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      const id = env.OVERLAY_ROOMS.idFromName(roomName);
      const stub = env.OVERLAY_ROOMS.get(id);

      const headers = new Headers(request.headers);
      headers.set("X-Overlay-Role", role === "control" ? "control" : "overlay");

      return stub.fetch(new Request(request, { headers }));
    }

    if (url.pathname.startsWith("/api/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const roomName = decodeURIComponent(parts[1] || "default");
      const action = parts[2] || "";

      const key = request.headers.get("X-Control-Key") || url.searchParams.get("key") || "";
      if (!env.CONTROL_KEY || key !== env.CONTROL_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }

      const id = env.OVERLAY_ROOMS.idFromName(roomName);
      const stub = env.OVERLAY_ROOMS.get(id);

      if (action === "command") {
        return stub.fetch(new Request("https://room/command", {
          method: request.method,
          headers: request.headers,
          body: request.body
        }));
      }

      if (action === "state") {
        return stub.fetch("https://room/state");
      }

      return new Response("Not found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
