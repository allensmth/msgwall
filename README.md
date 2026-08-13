# Markdown 消息板

通过 webhook 接收 Markdown 格式消息，并在网页上实时展示。适合高频消息推送场景（日志通知、CI/CD 状态、监控告警等）。

## 架构

```
webhook 客户端 ──POST /webhook──▶ Express 服务器 ──WebSocket 推送──▶ 浏览器（marked.js 渲染）
```

- **后端**：Node.js + Express + WebSocket（`ws`）
- **前端**：单页面，`marked.js` 渲染 Markdown + `DOMPurify` 防 XSS
- **实时推送**：WebSocket，新客户端连接时自动推送历史消息
- **高频优化**：前端用 `requestAnimationFrame` 批量渲染，避免 DOM 频繁重排

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务（默认端口 3000）
npm start

# 打开浏览器
open http://localhost:3000
```

## 发送消息

### JSON 格式（推荐）

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"content":"# 部署成功\n\n服务 **user-api** 已部署到 *production*，耗时 `42s`"}'
```

支持附加字段：

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "数据库连接异常，重试 3 次后恢复",
    "title": "DB Alert",
    "source": "monitor",
    "level": "WARN"
  }'
```

| 字段 | 说明 |
|------|------|
| `content` | Markdown 内容（必填） |
| `title` | 消息标题标签（可选） |
| `source` | 消息来源标签（可选） |
| `level` | 级别标签，如 `INFO`/`WARN`/`ERROR`（可选，有颜色区分） |

### 纯文本 Markdown

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: text/markdown" \
  -d '# Hello World

This is **markdown**.'
```

### Python 示例

```python
import requests

requests.post("http://localhost:3000/webhook", json={
    "content": "## 构建报告\n\n- ✅ 单元测试通过\n- ✅ 代码覆盖率 92%\n- ❌ E2E 测试 1 个失败",
    "source": "ci",
    "level": "ERROR"
})
```

## 配置

通过环境变量配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `MAX_MESSAGES` | `1000` | 内存中保留的最大消息条数 |
| `WEBHOOK_TOKEN` | 空（不鉴权） | 设置后 webhook 请求需带 `Authorization: Bearer <token>` |

```bash
PORT=8080 MAX_MESSAGES=5000 WEBHOOK_TOKEN=mysecret npm start
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/webhook` | 接收消息（JSON 或纯文本 Markdown） |
| `GET` | `/api/messages?limit=100` | 获取历史消息 |
| `GET` | `/health` | 健康检查 |
| `WS` | `/ws` | WebSocket 连接，实时接收消息 |

## 前端功能

- ✅ Markdown 实时渲染（GFM 语法、代码高亮、表格、图片等）
- ✅ XSS 防护（DOMPurify 清洗 HTML）
- ✅ 自动滚动到底部（向上滚动时暂停，显示"新消息"提示）
- ✅ 暂停/恢复滚动按钮
- ✅ 连接状态指示 + 自动重连
- ✅ 消息计数
- ✅ 高频消息批量渲染（requestAnimationFrame）
- ✅ 前端最多渲染 500 条（超出自动丢弃最旧的，防止 DOM 卡顿）

## 项目结构

```
markdown-message-board/
├── package.json
├── server.js          # 后端：Express + WebSocket
├── public/
│   └── index.html     # 前端：消息展示页面
└── README.md
```
