# JD AI 工作台

一个用于校招 JD 解析、简历匹配与面试准备的 AI 工作台。用户可以粘贴或上传 JD，选择 DeepSeek Chat / Reasoner，以流式方式获取岗位职责、技术栈、关键词、项目建议和面试问题；也可以上传简历生成结构化匹配报告。

## 功能

- DeepSeek 流式输出，API Key 只保存在 Express 服务端
- 新建、切换、删除本地会话，使用 localStorage 持久化
- 上传简历和 JD，使用 LangChain 生成匹配度、技能缺口、行动建议和面试问题
- MongoDB 保存匹配报告历史，支持查询、查看和删除
- ECharts 展示能力维度雷达图和技能匹配度柱状图
- TailwindCSS 用于匹配报告页的布局和组件样式
- 消息复制、删除、编辑后重新提问、重新生成
- `txt`、`md`、`csv`、`json`、`pdf`、`docx` 文件解析
- PDF 优先使用 `pdf-parse`，扫描版 PDF 自动使用 `pdfjs-dist` 渲染并由 `tesseract.js` OCR；DOCX 使用 `mammoth`；附件上下文最多保留 16000 个字符，并尽量保留文档开头和结尾
- Markdown、表格和代码块展示
- 聊天历史在浏览器中完整保留，但前端请求和服务端发往模型的上下文都限制为 24000 个字符，优先保留首条附件、最近问题和较新的中间消息
- 八股题库检索：按岗位方向筛选，由 Atlas Vector Search 召回语义相近题目，结合关键词加权排序，再由 AI 基于命中题目生成解释
- 每浏览器每天 10 次免费八股检索，自动保存检索记录，支持手动保存多轮对话

## 本地启动

前提：安装 Node.js 20 LTS 或更高版本，准备一个 DeepSeek API Key，并启动 MongoDB（默认地址为 `mongodb://127.0.0.1:27017`）。

```powershell
cd E:\JD\jd-ai-workbench
copy .env.example .env
```

编辑 `.env`，将 `your_deepseek_api_key` 替换为真实 Key。随后执行：

```powershell
npm install
npm run dev
```

打开 `http://localhost:5173`。Vite 前端会把 `/api` 请求转发到 `http://localhost:3001` 的 Express 服务。

`.env` 还可以配置：

```text
MONGODB_URI=mongodb://127.0.0.1:27017/jd-ai-workbench
MONGODB_DB_NAME=jd-ai-workbench
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_ANALYSIS_MODEL=deepseek-chat
EMBEDDING_API_KEY=your_siliconflow_api_key
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDING_MODEL=BAAI/bge-m3
MONGODB_VECTOR_INDEX=quiz_question_embedding
MONGODB_DNS_SERVERS=223.5.5.5,223.6.6.6
```

八股题库使用 MongoDB Atlas Vector Search。请在实际存储数据的 `quizquestions` 集合创建名为 `quiz_question_embedding` 的向量索引：`embedding` 为 1024 维 cosine 向量字段，`status` 和 `direction` 为 filter 字段。首次八股检索会初始化审核通过的前端、Node 和 AI 应用种子题库，并通过 `.env` 配置的 embedding 服务写入题目向量。

### 导入面试鸭题库

项目提供了 `scripts/import-mianshiya.ts`，从面试鸭公开的 `Vue`、`JavaScript`、`HTML`、`CSS`、`React` 和 `Agent` 标签页读取题目与题解，清洗后按来源 URL 幂等写入 MongoDB 的 `QuizQuestion` 集合，并默认调用 `.env` 中的 embedding 服务生成向量。没有公开标准答案的题目会被跳过，不会进入正式检索题库。

首次导入建议控制每个标签的数量，确认流程正常后再扩大范围：

```powershell
npm run import:mianshiya -- --limit-per-tag 30
```

可用参数：

```powershell
# 只导入指定标签
npm run import:mianshiya -- --tags Vue,React,Agent --limit-per-tag 50

# 只导入文本，不调用 embedding 服务；后续首次检索时服务端会补齐向量
npm run import:mianshiya -- --skip-embeddings
```

数据来源为面试鸭公开页面，导入记录保留原题目 URL，便于追溯和后续人工审核。来源仓库采用 MIT License；题目内容仍应遵守来源站点的使用条款。

### 维护内置种子题库

内置种子题库位于 `server/data/quiz-seed.json`，题目内容与检索逻辑分离。新增岗位方向或修改题目后，可以只更新 JSON 并执行下面的脚本同步到 MongoDB，不需要重新发布服务端代码：

```powershell
npm run import:quiz-seed
```

脚本按题目来源 URL 幂等新增或更新记录，并在题目内容变化时重新生成已配置的 embedding。只想同步文本、稍后由服务端在首次检索时补向量时可以使用：

```powershell
npm run import:quiz-seed -- --skip-embeddings
```

## 项目结构

```text
src/App.tsx       聊天页面、匹配报告入口和接口交互
src/components/   匹配报告、ECharts 图表和报告历史组件
src/store.ts      Zustand + localStorage 会话状态
server/index.ts   文件解析、聊天代理和匹配报告 API
server/analysis.ts LangChain + DeepSeek 结构化分析链
server/models/    Mongoose 分析报告模型
server/db.ts      MongoDB 连接复用
src/styles.css    响应式聊天工作台样式
src/tailwind.css  TailwindCSS 入口
```

## 数据流

```text
浏览器输入或上传文件
        |
        +--> POST /api/files/parse --> 提取文本/OCR，并限制为 16000 字符
        |
        +--> POST /api/chat --> Express 限制上下文后附加系统提示词 --> DeepSeek API
                                                          |
浏览器 TextDecoder <------ SSE 持续转发 <-----------------+

简历 + JD --> POST /api/analyses --> LangChain 结构化输出 --> MongoDB
                                         |
                              React + Zustand + ECharts 报告页
```

## 手动验收

1. 粘贴一份 JD，确认 AI 以五个固定标题流式输出。
2. 上传 PDF 或 DOCX，确认附件名称显示且回答引用文件内容。
3. 切换模型后发送新消息，确认会话保存该模型。
4. 编辑用户消息并再次发送，确认旧回答被替换；对 AI 消息使用重新生成。
5. 刷新浏览器，确认历史会话仍可打开。
6. 切换到“匹配报告”，上传简历并输入 JD，确认生成匹配度、技能缺口、图表和面试问题。
7. 确认匹配报告可以从 MongoDB 历史列表重新打开和删除。

## 面试说明

你应能解释：为什么 API Key 放在服务端 `.env`；Express 如何转发 DeepSeek SSE；前端如何通过 `ReadableStream` 和 `TextDecoder` 逐段更新 React 状态；LangChain 如何要求 DeepSeek 返回结构化 JSON；MongoDB 如何保存分析历史；ECharts 如何消费报告数据；PDF/DOCX 为什么先转为文本再进入模型上下文；localStorage 的优点与无法跨设备同步的局限。
