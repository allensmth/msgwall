const express = require('express');
const md = require('markdown-it')({
  html: true,
  linkify: true,
  typographer: true
});
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// 中间件
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// ---------------------------------------------------------------------------
// 内存消息存储（生产环境建议换成 Redis 等）
// ---------------------------------------------------------------------------
const messages = [];                          // 按时间顺序存储
const MAX_MESSAGES = 2000;                    // 最多保留 2000 条，防止内存泄漏
const CLIENT_EVENTS = new Map();              // SSE client 管理

// ---------------------------------------------------------------------------
// Webhook 接收端点
// ---------------------------------------------------------------------------
app.post('/webhook', (req, res) => {
  const raw = req.body;

  // 支持多种格式
  let content = '';
  let source = 'unknown';
  let author = '';

  if (typeof raw === 'string') {
    content = raw;
  } else if (raw.content || raw.text || raw.message || raw.body) {
    content = raw.content || raw.text || raw.message || raw.body;
    source = raw.source || raw.from || raw.channel || 'webhook';
    author = raw.author || raw.user || raw.sender || '';
  } else if (raw.markdown !== undefined) {
    content = raw.markdown;
    source = raw.source || 'webhook';
  } else {
    // 若整个 body 就是一段文本
    content = JSON.stringify(raw);
    source = 'webhook-raw';
  }

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'empty message' });
  }

  const msg = {
    id: uuidv4(),
    content: content.trim(),
    html: md.render(content.trim()),
    source: source || 'webhook',
    author: author || '',
    timestamp: Date.now(),
    raw: req.body
  };

  // 插入并裁剪溢出
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) {
    messages.splice(0, messages.length - MAX_MESSAGES);
  }

  // 广播给所有 SSE 客户端
  broadcast(JSON.stringify({
    type: 'message',
    data: msg
  }));

  res.json({ ok: true, id: msg.id });
});

// ---------------------------------------------------------------------------
// SSE 广播
// ---------------------------------------------------------------------------
function broadcast(payload) {
  const data = `${payload}\n\n`;
  for (const [res] of CLIENT_EVENTS) {
    if (!res.writableEnded) {
      res.write(data);
    }
  }
}

// ---------------------------------------------------------------------------
// SSE 端点 —— 前端通过此流实时获取消息
// ---------------------------------------------------------------------------
app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'   // 禁用 nginx 缓冲
  });

  // 立即推送已有消息（避免冷启动空白）
  const recent = getRecentMessages(80);
  res.write(`data: ${JSON.stringify({ type: 'history', data: recent })}\n\n`);

  CLIENT_EVENTS.set(res, res);

  req.on('close', () => {
    CLIENT_EVENTS.delete(res);
  });
});

// ---------------------------------------------------------------------------
// REST API: 获取最近消息（供初始加载或调试）
// ---------------------------------------------------------------------------
app.get('/api/messages', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  res.json({ messages: getRecentMessages(limit) });
});

function getRecentMessages(count) {
  return messages.slice(-count);
}

// ---------------------------------------------------------------------------
// 健康检查
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    messageCount: messages.length,
    connectedClients: CLIENT_EVENTS.size,
    uptime: process.uptime()
  });
});

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n📬 Message Wall running`);
  console.log(`   Webhook  POST http://0.0.0.0:${PORT}/webhook`);
  console.log(`   Stream   GET  http://0.0.0.0:${PORT}/stream`);
  console.log(`   Messages GET  http://0.0.0.0:${PORT}/api/messages`);
  console.log(`   Health   GET  http://0.0.0.0:${PORT}/health`);
  console.log(`   Frontend http://0.0.0.0:${PORT}/`);
  console.log(`\n   发送示例: curl -X POST http://0.0.0.0:${PORT}/webhook \\
      -H "Content-Type: application/json" \\
      -d '{"content":"**Hello** _world_","source":"test"}'\n`);
});
