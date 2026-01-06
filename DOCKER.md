# Docker 部署指南

## 构建镜像

```bash
docker build -t puppet-resume .
```

## 运行容器

### 方式 1: 直接运行

```bash
docker run -d \
  --name resume-generator \
  -p 80:80 \
  -e PORT=80 \
  puppet-resume
```

### 方式 2: 使用 docker-compose

```bash
docker-compose up -d
```

## 测试

```bash
# 健康检查
curl http://localhost:80/health

# 生成简历 PDF（示例）
curl -X POST http://localhost:80/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "name": "张三",
    "position": "前端开发工程师",
    "contact": {
      "email": "test@example.com"
    },
    "yearsOfExperience": 3,
    "education": [{
      "school": "XX大学",
      "graduationDate": "2020-2024"
    }],
    "personalIntroduction": "测试",
    "workExperience": [{
      "company": "XX公司",
      "position": "工程师",
      "startDate": "2021.1",
      "endDate": "至今"
    }]
  }' \
  --output resume.pdf
```

## 环境变量

- `PORT`: 服务端口（默认: 80）
  - ⚠️ 微信云托管强制要求监听 80 端口
- `NODE_ENV`: 运行环境（默认: production）

## 注意事项

1. **内存要求**: Puppeteer 需要较多内存，建议至少 1GB
2. **Chrome 依赖**: 镜像已包含 Chrome 和所需字体库
3. **端口映射**: 确保主机端口 80 未被占用

## 微信云托管部署

如果部署到微信云托管，可以：

1. 将 Dockerfile 放在项目根目录
2. 在云托管控制台配置：
   - 构建命令: `docker build -t resume .`
   - 启动命令: `docker run -p 80:80 resume`
   - 环境变量: `PORT=80`
   - ⚠️ 微信云托管强制要求监听 80 端口

