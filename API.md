# API 文档

## 生成简历 PDF

### 端点
`POST /api/generate`

### 请求方式

#### 方式 1: JSON 格式（推荐）

**Content-Type:** `application/json`

**请求体示例：**
```json
{
  "name": "张三",
  "position": "前端开发工程师",
  "contact": {
    "phone": "13800138000",
    "email": "zhangsan@example.com",
    "wechat": "zhangsan123"
  },
  "yearsOfExperience": 3,
  "languages": "中英双语",
  "avatar": "https://example.com/avatar.jpg",
  "education": [
    {
      "school": "XX大学",
      "degree": "计算机科学与技术 本科",
      "graduationDate": "2020-2024"
    }
  ],
  "personalIntroduction": "热爱前端开发...",
  "workExperience": [
    {
      "company": "XX科技有限公司",
      "position": "前端开发工程师",
      "startDate": "2021.7",
      "endDate": "至今",
      "responsibilities": [
        "负责公司前端项目的开发和维护"
      ]
    }
  ]
}
```

**头像支持格式：**
- URL: `"avatar": "https://example.com/avatar.jpg"`
- Base64: `"avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."`

#### 方式 2: FormData 格式（支持文件上传）

**Content-Type:** `multipart/form-data`

**字段：**
- `resumeData`: JSON 字符串（必需）
- `avatar`: 图片文件（可选，支持 jpg、png、gif 等，最大 5MB）

**cURL 示例：**
```bash
curl -X POST http://localhost:80/api/generate \
  -F "resumeData={\"name\":\"张三\",\"position\":\"前端开发工程师\",...}" \
  -F "avatar=@/path/to/avatar.jpg"
```

**JavaScript 示例：**
```javascript
const formData = new FormData();
formData.append('resumeData', JSON.stringify({
  name: '张三',
  position: '前端开发工程师',
  // ... 其他字段
}));
formData.append('avatar', fileInput.files[0]);

fetch('http://localhost:80/api/generate', {
  method: 'POST',
  body: formData
})
.then(response => response.blob())
.then(blob => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'resume.pdf';
  a.click();
});
```

### 响应

**成功：**
- **Content-Type:** `application/pdf`
- **Content-Disposition:** `attachment; filename="resume-{name}.pdf"`
- **Body:** PDF 文件二进制数据

**错误：**
- **Status Code:** 400/500
- **Content-Type:** `application/json`
- **Body:**
```json
{
  "error": "错误描述",
  "message": "详细错误信息"
}
```

## 健康检查

### 端点
`GET /health`

### 响应
```json
{
  "status": "ok"
}
```

## 微信云托管部署

### 环境变量
- `PORT`: 服务端口（默认: 80）
  - ⚠️ 微信云托管强制要求监听 80 端口

### Dockerfile 示例
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

# ⚠️ 微信云托管强制要求监听 80 端口
EXPOSE 80

CMD ["node", "dist/server.js"]
```

### 微信云存储图片 URL
如果头像存储在微信云存储中，可以直接使用云存储的 URL：
```json
{
  "avatar": "https://your-cloud-storage-url.com/avatar.jpg"
}
```

## 注意事项

1. **图片大小限制：** 文件上传限制为 5MB
2. **支持的图片格式：** jpg, jpeg, png, gif, webp 等
3. **Base64 格式：** 必须包含 MIME 类型，如 `data:image/jpeg;base64,...`
4. **超时设置：** PDF 生成可能需要一些时间，建议设置合理的超时时间

