# 微博账号智能管家

一个可长期演进的 `Web + Server` 微博运营系统，用于生成微博草稿、管理账号、同步数据、消息提醒和本地持久化。

当前版本已经实现：
- 热点草稿生成：基于多来源热门话题检索 + 大模型生成微博正文
- 每日一善草稿生成：一键生成不少于 100 字的正能量微博
- AI 润色：支持只润色正文，或同时润色图片
- 图片生成：支持 OpenAI 兼容协议，也支持阿里云百炼 DashScope `qwen-image-2.0` / `qwen-image-2.0-pro`
- 微博账号登录：支持微博 OAuth 登录并查看基础资料
- 数据管理：持久化保存草稿、账号指标、帖子指标、通知消息
- 文件备份：SQLite 数据库支持手动备份和定时备份
- 审批提醒：支持飞书等 webhook 通知

## 主要能力

### 1. 内容管理

- 准点生成可配置：开始小时、结束小时、提前生成分钟、提前提醒分钟都可在配置中心调整
- 立即生成热点草稿：每次都会新增一条持久化草稿，不覆盖历史数据
- 立即生成每日一善超话草稿：固定保留以下标签
  - `#每日一善[超话]#`
  - `#每日一善#`
  - `#阳光信用#`
- 草稿状态流转：`pending -> approved / rejected / sent`
- 所有草稿都支持逻辑删除，不会物理丢失
- 首页默认展示今日微博，支持按范围过滤
  - 今日
  - 昨日
  - 本周
  - 近 7 天
  - 近 30 天

### 2. 热门话题检索

当前支持多来源聚合，并支持启用、停用和优先级配置：
- 微博热搜
- 知乎热榜
- Google 新闻热点

规则：
- 先按优先级抓取候选话题
- 再结合你选择的内容板块，用大模型判断哪些话题匹配板块
- 如果有命中的话题，优先使用高优先级来源
- 如果没有命中，则按所选板块自由发挥生成内容

微博热搜来源还支持单独配置排名区间，例如：`20-30`。

### 3. 内容板块

内置常见板块：
- 科技
- 财经
- 娱乐
- 军事
- 体育
- 社会
- 国际
- 汽车
- 游戏
- 教育
- 健康
- 生活方式

### 4. AI 润色

每条微博卡片支持 `AI 润色`：
- 输入修改建议后重新生成正文
- 可选“同时润色图片”
- 润色失败时不会写入脏数据，只会保留原草稿并发通知

### 5. 图片生成

支持两类图片生成协议：
- OpenAI 兼容接口：`/images/generations`
- DashScope 百炼接口：`qwen-image-2.0` / `qwen-image-2.0-pro`

图片生成特性：
- 当 `OPENAI_IMAGE_MODEL` 未配置时，系统不会生成图片
- 多图生成会为每张图构造不同的 prompt，避免内容过于相似
- 图片宽高可以在配置中心设置

### 6. 账号与数据管理

- 微博 OAuth 登录
- 查看微博账号基本资料
- 同步粉丝数、关注数等账号数据
- 同步帖子阅读、点赞、评论、转发等统计数据
- 使用 SQLite 持久化存储，并保留备份文件

### 7. 通知中心

- 生成成功、生成失败、润色成功、润色失败都会写入通知
- 支持 Feishu / 自定义 webhook
- 支持单条已读
- 支持一键全部已读

## 技术栈

- 后端：Node.js + Express + node-cron
- 前端：原生 HTML / CSS / JavaScript
- 数据库：SQLite
- 网络请求：axios
- 时间处理：dayjs

## 目录结构

```txt
.
├─ public/                 # 前端控制台
├─ src/
│  ├─ routes/              # HTTP 路由
│  ├─ services/            # 领域服务（生成、通知、账号、统计、备份等）
│  ├─ app.js               # Express app
│  ├─ config.js            # 环境变量读取
│  ├─ db.js                # SQLite 初始化与表结构
│  ├─ logger.js            # 日志
│  ├─ scheduler.js         # 定时任务
│  ├─ topicSources.js      # 热门话题来源定义
│  └─ contentCategories.js # 内容板块定义
├─ data/                   # SQLite 数据文件
├─ backups/                # 备份目录
├─ logs/                   # 日志目录
├─ .env.example
└─ README.md
```

## 本地启动

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

### 3. 填写 `.env`

最少需要关注这些变量：

```env
PORT=3000
TIMEZONE=Asia/Shanghai

OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TEXT_MODEL=gpt-4o-mini

OPENAI_IMAGE_API_KEY=
OPENAI_IMAGE_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_PROTOCOL=openai
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_WIDTH=1024
OPENAI_IMAGE_HEIGHT=1024

WEIBO_APP_KEY=
WEIBO_APP_SECRET=
WEIBO_REDIRECT_URI=http://localhost:3000/api/auth/weibo/callback

REMINDER_WEBHOOK_URL=
AUTO_SYNC_METRICS=true
TIMELINE_SYNC_COUNT=20
```

说明：
- `OPENAI_IMAGE_MODEL` 为空：不生成图片
- `OPENAI_IMAGE_API_KEY / OPENAI_IMAGE_BASE_URL` 为空：默认回退复用文本模型的凭证和地址
- `REMINDER_WEBHOOK_URL` 可接飞书 webhook

### 4. DashScope 百炼图片模型示例

如果要使用阿里云百炼：

```env
OPENAI_IMAGE_PROTOCOL=dashscope
OPENAI_IMAGE_API_KEY=你的百炼 API Key
OPENAI_IMAGE_BASE_URL=https://dashscope.aliyuncs.com/api/v1
OPENAI_IMAGE_MODEL=qwen-image-2.0
```

或：

```env
OPENAI_IMAGE_MODEL=qwen-image-2.0-pro
```

### 5. 启动项目

开发模式：

```bash
npm run dev
```

生产模式：

```bash
npm start
```

打开：

[http://localhost:3000](http://localhost:3000)

## 页面结构

### 主页

- 顶部 banner：菜单、消息通知、微博账号头像和名称
- 主区域：微博内容列表
- 右侧快捷操作台：
  - 立即生成热点草稿
  - 立即生成每日一善超话草稿
  - 测试消息通知
- 右侧提醒消息：支持单条已读和全部已读

### 数据中心

- 账号概览
- 最近微博数据
- 数据备份列表

### 配置中心

- 准点配置
- 内容板块配置
- 热门话题检索源配置
- 模型超时配置
- 图片尺寸配置
- 原始账号数据查看

## 数据持久化说明

所有核心数据都会保存到 SQLite：
- 草稿内容
- 草稿图片地址
- 草稿状态
- 通知消息
- 账号快照
- 帖子统计数据

数据库文件默认位于：
- [data/weibo_manager.db](/mnt/c/Users/Raphael/Documents/Playground/weibo-master/data/weibo_manager.db)

备份文件默认位于：
- [backups](/mnt/c/Users/Raphael/Documents/Playground/weibo-master/backups)

日志文件默认位于：
- [logs/app.log](/mnt/c/Users/Raphael/Documents/Playground/weibo-master/logs/app.log)

## 核心接口

### 内容相关

- `GET /api/content/drafts?preset=today|yesterday|this_week|last_7d|last_30d`
- `POST /api/content/generate-next`
- `POST /api/content/generate-daily-kindness`
- `POST /api/content/drafts/:id/refine`
- `POST /api/content/drafts/:id/approve`
- `POST /api/content/drafts/:id/reject`
- `POST /api/content/drafts/:id/sent`
- `DELETE /api/content/drafts/:id`
- `GET /api/content/settings`
- `PUT /api/content/settings`

### 通知相关

- `GET /api/content/notifications?unreadOnly=true`
- `POST /api/content/notifications/:id/read`
- `POST /api/content/notifications/read-all`

### 账号相关

- `GET /api/auth/weibo/login`
- `GET /api/auth/weibo/callback`
- `GET /api/auth/me`
- `POST /api/auth/sync`

### 数据相关

- `POST /api/stats/sync`
- `GET /api/stats/overview`
- `GET /api/stats/history?limit=100`

### 系统相关

- `GET /api/system/health`
- `POST /api/system/backup`
- `GET /api/system/backups`
- `POST /api/system/notify/test`

## 定时任务

系统内置以下定时任务：
- 草稿生成：按配置的发布时间窗口，在发布前若干分钟生成下一时段草稿
- 审批提醒：按配置的提醒提前量发送通知
- 数据同步：可按配置自动同步微博数据
- 数据备份：每日自动备份 SQLite 文件

## 当前设计原则

- 先做模块化单体，保留后续拆分能力
- 草稿、通知、统计、账号、备份分层清晰
- 失败不写脏数据，优先保证持久化质量
- 所有关键动作落日志，便于排查问题

## 后续可扩展方向

- 多微博账号支持
- 审批工作流和多角色协作
- Docker / docker-compose 一键部署
- 对象存储接入，持久化图片资产
- 更细粒度的内容策略和分镜式配图
- 趋势分析、最佳发布时间推荐、数据看板
