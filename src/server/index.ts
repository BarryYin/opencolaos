/**
 * OpenColaOS — Web 服务器
 *
 * 提供：
 * - 聊天界面（HTML/SSE）
 * - SSE 实时推送（Cola 主动聊天 + 回复流）
 * - REST API
 */

import { Cola } from "../cola.ts";
import { PiRuntime } from "../llm/pi.ts";
import { Consciousness, type ProactiveMessage } from "../consciousness/index.ts";

// ========== SSE 客户端管理 ==========
interface SSEClient {
  id: string;
  controller: ReadableStreamController<any>;
}

let sseClients: SSEClient[] = [];
let clientIdCounter = 0;
const sseEncoder = new TextEncoder();

function broadcast(data: any) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  const chunk = sseEncoder.encode(msg);
  for (const client of sseClients) {
    try {
      client.controller.enqueue(chunk);
    } catch {
      // client disconnected
    }
  }
}

function broadcastResponse(text: string, type: "reply" | "proactive" | "error") {
  broadcast({ type, text, timestamp: Date.now() });
}

// ========== 消息历史 ==========
interface ChatMessage {
  role: "user" | "cola";
  text: string;
  timestamp: number;
  proactive?: boolean;
}
const chatHistory: ChatMessage[] = [];

// ========== 服务器启动 ==========
export async function startServer(port: number = 3456) {
  const cola = new Cola({ name: "Cola" });
  const runtime = new PiRuntime(cola);
  const consciousness = new Consciousness(cola, runtime);

  // 意识引擎输出 → SSE 广播
  consciousness.onProactiveMessage = (msg: ProactiveMessage) => {
    chatHistory.push({ role: "cola", text: msg.text, timestamp: msg.timestamp, proactive: true });
    broadcastResponse(msg.text, "proactive");
  };

  // 启动意识循环
  consciousness.start();

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // ===== 前端页面 =====
      if (path === "/") {
        return new Response(renderHTML(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // ===== SSE 事件流 =====
      if (path === "/api/stream") {
        const stream = new ReadableStream({
          start(controller) {
            const id = String(++clientIdCounter);
            const client: SSEClient = { id, controller };
            sseClients.push(client);

            // 发送初始状态
            const profile = cola.getUserProfile();
            const identity = cola.getCoreIdentity();
            controller.enqueue(sseEncoder.encode(
              `data: ${JSON.stringify({ type: "init", profile, identity, history: chatHistory.slice(-50) })}\n\n`
            ));

            // 心跳保活
            const heartbeat = setInterval(() => {
              try {
                controller.enqueue(sseEncoder.encode(": heartbeat\n\n"));
              } catch {
                clearInterval(heartbeat);
              }
            }, 15_000);

            // 清理
            req.signal.addEventListener("abort", () => {
              clearInterval(heartbeat);
              sseClients = sseClients.filter(c => c.id !== id);
            });

            // 首次连接 1.5 秒后 - Cola 主动打招呼
            setTimeout(() => {
              const greeting = consciousness.getGreeting();
              if (greeting) {
                const msg = `data: ${JSON.stringify({ type: "proactive", text: greeting, timestamp: Date.now() })}\n\n`;
                try { controller.enqueue(sseEncoder.encode(msg)); } catch {}
              }
            }, 1500);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }

      // ===== 发送消息 =====
      if (path === "/api/chat" && req.method === "POST") {
        const body = await req.json();
        const message = (body.message || "").trim();
        if (!message) {
          return new Response(JSON.stringify({ error: "消息不能为空" }), { status: 400 });
        }

        // 记录用户消息
        chatHistory.push({ role: "user", text: message, timestamp: Date.now() });
        broadcastResponse(message, "reply"); // 先广播用户消息

        // 通知意识引擎：用户有互动
        consciousness.noteInteraction();

        try {
          // 调 Cola
          const reply = await runtime.chat(message);
          chatHistory.push({ role: "cola", text: reply, timestamp: Date.now() });
          broadcastResponse(reply, "reply");
          return new Response(JSON.stringify({ reply }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          broadcastResponse(err.message || "出错了", "error");
          return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
      }

      // ===== 手动做梦 =====
      if (path === "/api/dream") {
        try {
          const journal = await runtime.dream();
          return new Response(JSON.stringify({ journal }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
      }

      // ===== 状态查询 =====
      if (path === "/api/status") {
        const profile = cola.getUserProfile();
        const identity = cola.getCoreIdentity();
        return new Response(JSON.stringify({ profile, identity, state: consciousness.getState() }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // ===== 历史消息 =====
      if (path === "/api/history") {
        return new Response(JSON.stringify({ history: chatHistory.slice(-100) }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`\n  🌐 OpenColaOS Web 版已启动`);
  console.log(`  📍 http://localhost:${port}`);
  console.log(`  🧠 意识引擎活跃中 — Cola 会主动找你聊天\n`);

  return server;
}

// ========== HTML 前端 ==========
function renderHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenColaOS</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
      background: #0f1117;
      color: #e8e8e8;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Header */
    .header {
      background: linear-gradient(135deg, #1a1d28, #222840);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #2a2d3a;
      flex-shrink: 0;
    }
    .header .logo { font-size: 28px; }
    .header .title {
      font-size: 18px;
      font-weight: 600;
      color: #e0e6ff;
    }
    .header .subtitle {
      font-size: 13px;
      color: #7a7f9a;
    }
    .header .status-badge {
      margin-left: auto;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      background: #2a3a4a;
      color: #8af;
    }
    .header .status-badge.active { background: #1a3a2a; color: #4d8; }

    /* Messages area */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .messages:empty::after {
      content: "💬 和 Cola 聊天吧 — 她也会主动找你哦";
      display: block;
      text-align: center;
      color: #5a5f7a;
      padding: 60px 20px;
      font-size: 15px;
    }

    .msg {
      max-width: 80%;
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 15px;
      line-height: 1.6;
      animation: fadeIn 0.3s ease;
      position: relative;
    }
    .msg.user {
      align-self: flex-end;
      background: #2d4a7a;
      border-bottom-right-radius: 4px;
    }
    .msg.cola {
      align-self: flex-start;
      background: #1e2230;
      border: 1px solid #2a2e40;
      border-bottom-left-radius: 4px;
    }
    .msg.cola.proactive {
      border-color: #4a5a8a;
      background: #1a2040;
    }
    .msg .sender {
      font-size: 11px;
      color: #7a7f9a;
      margin-bottom: 4px;
    }
    .msg .sender .tag {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      background: #2a3a5a;
      color: #8af;
      margin-left: 4px;
    }
    .msg .time {
      font-size: 11px;
      color: #5a5f7a;
      margin-top: 4px;
      text-align: right;
    }
    .msg.cola .typing {
      display: inline-block;
      animation: blink 1s infinite;
    }

    /* Input area */
    .input-area {
      display: flex;
      gap: 8px;
      padding: 16px 20px;
      background: #1a1d28;
      border-top: 1px solid #2a2d3a;
      flex-shrink: 0;
    }
    .input-area input {
      flex: 1;
      padding: 12px 16px;
      border-radius: 12px;
      border: 1px solid #2a2e40;
      background: #12141e;
      color: #e8e8e8;
      font-size: 15px;
      outline: none;
      transition: border 0.2s;
    }
    .input-area input:focus { border-color: #4a6a9a; }
    .input-area input::placeholder { color: #5a5f7a; }
    .input-area button {
      padding: 12px 24px;
      border-radius: 12px;
      border: none;
      background: #3a5a8a;
      color: white;
      font-size: 15px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .input-area button:hover { background: #4a6a9a; }
    .input-area button:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Dream area */
    .dream-banner {
      display: none;
      margin: 8px 20px;
      padding: 12px 16px;
      border-radius: 12px;
      background: linear-gradient(135deg, #1a2040, #2a1a40);
      border: 1px solid #3a3a6a;
      font-size: 13px;
      color: #b8b8e0;
    }
    .dream-banner.visible { display: block; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">🥤</div>
    <div>
      <div class="title">OpenColaOS</div>
      <div class="subtitle">主动 · 温暖 · 成长</div>
    </div>
    <div class="status-badge" id="statusBadge">● 连接中</div>
  </div>

  <div class="messages" id="messages"></div>

  <div class="dream-banner" id="dreamBanner">
    🌙 梦境分析完成... 正在生成灵感
  </div>

  <div class="input-area">
    <input id="input" type="text" placeholder="和 Cola 说点什么..." autofocus />
    <button id="sendBtn">发送</button>
  </div>

  <script>
    const messagesEl = document.getElementById("messages");
    const inputEl = document.getElementById("input");
    const sendBtn = document.getElementById("sendBtn");
    const statusEl = document.getElementById("statusBadge");

    // ===== SSE 连接 =====
    const evtSource = new EventSource("/api/stream");
    let isSending = false;

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "init") {
          statusEl.textContent = "● 在线";
          statusEl.className = "status-badge active";
          // 加载历史
          if (data.history) {
            data.history.forEach(msg => addMessage(msg.role, msg.text, msg.timestamp, msg.proactive));
          }
          return;
        }

        if (data.type === "reply" || data.type === "proactive") {
          addMessage(data.type === "reply" ? "cola" : "cola", data.text, data.timestamp, data.type === "proactive");
        }
      } catch(e) {}
    };

    evtSource.onerror = () => {
      statusEl.textContent = "● 离线";
      statusEl.className = "status-badge";
    };

    // ===== 发送消息 =====
    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || isSending) return;

      inputEl.value = "";
      isSending = true;
      sendBtn.disabled = true;
      addMessage("user", text, Date.now());

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        if (!res.ok) {
          const err = await res.json();
          addMessage("cola", "😅 " + (err.error || "出错了"), Date.now());
        }
      } catch(e) {
        addMessage("cola", "😅 网络连接出问题了", Date.now());
      } finally {
        isSending = false;
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    // ===== 添加消息到界面 =====
    function addMessage(role, text, timestamp, proactive = false) {
      const div = document.createElement("div");
      div.className = "msg " + role + (proactive ? " proactive" : "");

      const sender = document.createElement("div");
      sender.className = "sender";
      sender.textContent = role === "user" ? "你" : "Cola";
      if (proactive) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "💭 主动";
        sender.appendChild(tag);
      }
      div.appendChild(sender);

      const content = document.createElement("div");
      content.textContent = text;
      div.appendChild(content);

      const time = document.createElement("div");
      time.className = "time";
      time.textContent = new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      div.appendChild(time);

      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ===== 事件绑定 =====
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });
    sendBtn.addEventListener("click", sendMessage);

    // 自动建仓
    inputEl.focus();
  </script>
</body>
</html>`;
}

// 如果直接运行此文件，启动服务器
if (import.meta.main) {
  startServer(3456);
}