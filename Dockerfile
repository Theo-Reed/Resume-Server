# 1. 选择基础镜像
FROM node:18-slim

# 2. 替换 Debian 软件源为阿里云镜像 (加速系统包下载，防止连接 Debian 官方源超时)
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources

# 3. [关键修正] 不再安装 google-chrome-stable
# 而是手动安装 Puppeteer 运行所需的依赖库 (这些库都在 Debian 官方源里，国内能连上)
RUN apt-get update \
    && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 4. 设置 Puppeteer 下载源为国内镜像 (关键！否则 npm install 时下载浏览器会卡死)
ENV PUPPETEER_DOWNLOAD_HOST=https://npmmirror.com/mirrors

# 5. 设置工作目录
WORKDIR /app

# 6. 复制并安装依赖（包括开发依赖，用于构建）
COPY package*.json ./
RUN npm install

# 7. 复制源码并构建 TypeScript 项目
COPY . .
RUN npm run build

# 8. 删除开发依赖，只保留生产依赖
RUN npm prune --production

# 9. 暴露端口
# ⚠️ 微信云托管强制要求监听 80 端口
EXPOSE 80

# 10. 设置环境变量
ENV NODE_ENV=production
# ⚠️ 微信云托管强制要求监听 80 端口
ENV PORT=80

# 11. 启动命令（使用编译后的 server.js）
CMD ["node", "dist/server.js"]
