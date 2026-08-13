const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

// ── 配置 ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MAX_MESSAGES = parseInt(process.env.MAX_MESSAGES || '1000', 10); // 内存缓冲上限
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || ''; // 可选：webhook 鉴权 token

// ── 消息存储（内存环形缓冲） ──────────────────────────
const messages = [];
let messageSeq = 0;

function addMessage(content, extra = {}) {
  const msg = {
    id: ++messageSeq,
    content,
    timestamp: new Date().toISOString(),
    ...extra,
  };
  messages.push(msg);
  // 超出上限时丢弃最旧的消息
  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }
  return msg;
}

// ── Express 应用 ──────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb', type: ['text/markdown', 'text/plain'] }));
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', messages: messages.length, clients: wss.clients.size });
});

// 获取历史消息（REST 方式，可选）
app.get('/api/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), MAX_MESSAGES);
  const start = Math.max(0, messages.length - limit);
  res.json({ total: messages.length, messages: messages.slice(start) });
});

// ── Webhook 端点 ──────────────────────────────────────
app.post('/webhook', (req, res) => {
  // 可选 token 鉴权
  if (WEBHOOK_TOKEN) {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== WEBHOOK_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  let content;
  let extra = {};

  // 支持多种输入格式
  if (typeof req.body === 'string') {
    // raw text/markdown 或 text/plain
    content = req.body;
  } else if (req.body && typeof req.body === 'object') {
    // JSON 格式: { "content": "...", "title": "...", "source": "..." }
    content = req.body.content || req.body.message || req.body.text || '';
    if (req.body.title) extra.title = req.body.title;
    if (req.body.source) extra.source = req.body.source;
    if (req.body.level) extra.level = req.body.level;
  } else {
    return res.status(400).json({ error: 'empty body' });
  }

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content is empty' });
  }

  const msg = addMessage(content, extra);

  // 通过 WebSocket 实时推送给所有连接的客户端
  const payload = JSON.stringify({ type: 'message', data: msg });
  let sent = 0;
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(payload);
      sent++;
    }
  }

  res.status(200).json({ ok: true, id: msg.id, pushed_to: sent });
});

// ── HTTP + WebSocket 服务器 ───────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // 新客户端连接时，推送历史消息
  const historyPayload = JSON.stringify({
    type: 'history',
    data: messages,
    total: messages.length,
  });
  ws.send(historyPayload);

  // 心跳保活
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// 心跳检测，清理断开的连接
const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.on('close', () => clearInterval(heartbeatInterval));

// ── 启动 ──────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`┌─────────────────────────────────────────────┐`);
  console.log(`│  Markdown Message Board                     │`);
  console.log(`├─────────────────────────────────────────────┤`);
  console.log(`│  Web 界面:   http://0.0.0.0:${PORT}              │`);
  console.log(`│  Webhook:    http://0.0.0.0:${PORT}/webhook      │`);
  console.log(`│  WebSocket:  ws://0.0.0.0:${PORT}/ws            │`);
  console.log(`│  历史消息:   http://0.0.0.0:${PORT}/api/messages │`);
  console.log(`│  缓冲上限:   ${MAX_MESSAGES} 条                    │`);
  console.log(`└─────────────────────────────────────────────┘`);
});
