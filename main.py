import asyncio
import json
import logging
from typing import List, Optional
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

# 初始化 FastAPI 应用
app = FastAPI(title="Terminal Style News Feed with SSE & Webhook")

# 配置 CORS 允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 设置日志格式
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("news-feed")

# 用于保存客户端连接的 SSE 队列列表
clients = []

# Pydantic 消息体模型（支持多张图片）
class NewsMessage(BaseModel):
    channel: str                     # 频道名 (例如: tech, finance, world, life)
    username: str                    # 用户名 (例如: techdaily, econ_watch)
    content: str                     # 消息内容 (支持 Markdown 格式)
    image_urls: Optional[List[str]] = None  # 可选的多张配图 URL 列表
    image_url: Optional[str] = None         # 保持向下兼容的单张配图字段

@app.get("/", response_class=HTMLResponse)
async def get_index():
    """主页：直接返回极客终端风格的 HTML 静态页面"""
    with open("templates/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.post("/webhook/news")
async def post_news(news: NewsMessage):
    """
    接收推送新闻的 Webhook 接口
    """
    # 整合单张与多张图片的逻辑
    urls = []
    if news.image_urls:
        urls.extend(news.image_urls)
    elif news.image_url:
        urls.append(news.image_url)

    payload = {
        "channel": news.channel.strip().lower(),
        "username": news.username.strip(),
        "content": news.content,
        "image_urls": urls
    }
    logger.info(f"Received webhook news: {payload}")
    
    # 异步推送到所有在线客户端的队列中
    for queue in clients:
        await queue.put(payload)
        
    return {"status": "success", "delivered_to_clients": len(clients)}

@app.get("/stream")
async def message_stream(request: Request):
    """
    SSE 服务端数据流接口
    """
    queue = asyncio.Queue()
    clients.append(queue)
    logger.info(f"Client connected. Active clients: {len(clients)}")

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                
                try:
                    news_data = await asyncio.wait_for(queue.get(), timeout=1.0)
                    yield f"event: news\ndata: {json.dumps(news_data)}\n\n"
                except asyncio.TimeoutError:
                    # 发送心跳数据包，维持 SSE 长连接
                    yield "event: heartbeat\ndata: ping\n\n"
                    
        except asyncio.CancelledError:
            logger.info("SSE connection cancelled.")
        finally:
            clients.remove(queue)
            logger.info(f"Client disconnected. Active clients: {len(clients)}")

    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
