# 部署到云端（离开自己的电脑也能玩）

项目是 Node.js 动态服务（SSE 长连接 + 内存房间状态），改一行都不用就能跑在任何 Linux + Node.js 环境。下面是**两个免费方案**和**一个国内稳定方案**的逐步操作。

> 服务现状：监听 `0.0.0.0:PORT`、静态文件用 `__dirname` 拼、零外部依赖、约 724 KB。云端部署只是把"你的 Mac"换成"一台 24 小时在线的服务器"。

---

## 方案 B（推荐起步）：Render 免费云

**优点**：真·免费，无限期<br>
**缺点**：15 分钟没人访问会休眠，下一个访问要等 10-30 秒冷启动；免费层共享 CPU

### 步骤

1. **把代码推到 GitHub**（一次性）
   ```bash
   cd /Users/jicj/WorkBuddy/2026-10-14-10-50-42/mahjong
   git init
   git add .
   git commit -m "init"
   # 在 github.com 创建一个新仓库（不要勾 README/.gitignore/license），然后：
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git branch -M main
   git push -u origin main
   ```

2. **Render 注册 + 部署**
   - 打开 https://render.com ，用 GitHub 账号登录
   - 控制台点 **New +** → **Web Service**
   - 选刚 push 的仓库 → Connect
   - 配置：
     - **Name**: `nanjing-mahjong`（决定子域名）
     - **Region**: `Singapore`（离国内近）
     - **Branch**: `main`
     - **Runtime**: `Node`
     - **Build Command**: `npm install`（其实没依赖，会立即完成）
     - **Start Command**: `npm start`
     - **Instance Type**: `Free`
   - 点 **Advanced** → 加环境变量（可选）：
     - `BOT_DELAY=750`
     - `BOT_CLAIM_DELAY=600`
     - `TURN_TIMEOUT_MS=20000`
   - 点 **Create Web Service**，等 2-3 分钟部署完成

3. **拿到公网地址**
   - 部署成功后会显示 `https://nanjing-mahjong.onrender.com`
   - 手机浏览器、朋友电脑、任何地方都能访问

> 第一次访问会有 10-30 秒冷启动（从休眠唤醒），之后游戏流畅运行。

---

## 方案 B 备选：Railway

**优点**：不冷启动，自动 HTTPS，体验最好<br>
**缺点**：**严格说不是免费**——新用户有 5 美元试用额度（约 1 个月），之后 5 美元/月起

部署步骤几乎和 Render 一样：https://railway.app → New Project → Deploy from GitHub Repo → 自动识别 Node.js → 设置 start command → 等部署。

---

## 方案 C（长期稳定）：腾讯云轻量应用服务器

**优点**：国内访问快、4 Mbps 带宽、永久在线<br>
**缺点**：约 40 元/月

### 步骤

1. 打开 https://cloud.tencent.com/product/lighthouse ，买一台**轻量应用服务器**：
   - 区域：**上海**或**广州**（国内）
   - 镜像：**Ubuntu 22.04 LTS**
   - 套餐：最低档（约 38 元/月，2 核 2 GB 就够 4 人麻将）
   - 带宽：4 Mbps

2. **配置防火墙**：在控制台"防火墙"标签页，**开放 8420 端口**（TCP）

3. **SSH 登录服务器**，执行：
   ```bash
   # 装 Node.js 20
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs

   # 上传代码（在你的 Mac 上执行，把 scp 命令里的 IP 换成服务器公网 IP）
   scp -r /Users/jicj/WorkBuddy/2026-10-14-10-50-42/mahjong root@<服务器IP>:/opt/mahjong
   # 在服务器上：
   ssh root@<服务器IP>
   cd /opt/mahjong
   ```

4. **用 pm2 守护进程**（可选，但推荐）
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name mahjong
   pm2 save
   pm2 startup   # 让 pm2 开机自启
   ```

5. **访问**：浏览器打开 `http://<服务器公网IP>:8420`

---

## 自定义域名（可选）

任何方案都能加域名：
1. 买个域名（万网 / Cloudflare Registrar / Porkbun）
2. 解析一个 CNAME 到平台给的域名（如 `nanjing-mahjong.onrender.com`）
3. 在平台控制台加自定义域名，平台自动签发 HTTPS 证书

---

## 调试

- **服务日志**：平台控制台自带日志查看器
- **重启丢房间**：项目用内存状态存房间，重启后所有玩家和房间会清空——这只是"对局状态"，不影响代码本身，重新开局即可
- **升级套餐**：当朋友多了不够用（CPU/带宽顶满）时再考虑升级，免费层一般能撑 4-8 人同时对局
