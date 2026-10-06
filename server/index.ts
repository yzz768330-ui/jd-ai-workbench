import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createCanvas } from "@napi-rs/canvas";
import mammoth from "mammoth";
import multer from "multer";
import pdfParse from "pdf-parse";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Readable } from "node:stream";
import path from "node:path";
import { generateMatchReport } from "./analysis";
import { connectDatabase } from "./db";
import { createWorker } from "tesseract.js";
import { Analysis } from "./models/Analysis";
import { QuizConversation, QuizQuota, QuizRecord } from "./models/QuizRecord";
import { dailyFreeLimit, generateQuizAnswer, searchQuestionBank } from "./quiz";
import type { QuizDirection, QuizMessage } from "../src/types";
import { parsePdfWithMultimodalAI } from "./parsing/multimodal";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT ?? 3001);
const supportedTextExtensions = new Set([".txt", ".md", ".csv", ".json"]);
const maxFileContextChars = 16000;
const maxChatContextChars = 24000;
const maxOcrPages = 8;

//这里的cors是干啥嘛用的
//
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/**
 * 使用多模态 AI 或 OCR 识别没有文本层的扫描版 PDF
 * @returns { text: string, method: 'multimodal' | 'ocr' } 返回解析结果和使用的解析方式
 */
async function extractPdfTextWithOcr(
  buffer: Buffer,
): Promise<{ text: string; method: "multimodal" | "ocr" }> {
  const multimodalEnabled = process.env.ENABLE_MULTI_MODAL === "true";
  let multimodalResult: { text: string; method: "multimodal" } | null = null;

  // 尝试多模态 AI 解析
  if (multimodalEnabled) {
    try {
      multimodalResult = await parsePdfWithMultimodalAI(buffer);
      console.log("✅ 多模态 AI 解析成功");
      return multimodalResult;
    } catch (multimodalError) {
      console.warn(`⚠️ 多模态解析失败，降级到 OCR：${multimodalError.message}`);
    }
  }

  // 兜底：Tesseract OCR
  const worker = await createWorker("chi_sim+eng");
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pageTexts: string[] = [];

  try {
    for (
      let pageNumber = 1;
      pageNumber <= Math.min(pdf.numPages, maxOcrPages);
      pageNumber += 1
    ) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const canvasContext = canvas.getContext("2d");
      await page.render({ canvasContext: canvasContext as never, viewport })
        .promise;
      const result = await worker.recognize(canvas.toBuffer("image/png"));
      if (result.data.text.trim()) pageTexts.push(result.data.text.trim());
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    await pdf.destroy();
  }

  return {
    text: pageTexts.join("\n\n"),
    method: "ocr",
  };
}

/** 从上传的 JD 附件中提取可读文本，扫描版 PDF 无文本层时切换到多模态 AI 或 OCR。 */
async function extractFileText(
  file: Express.Multer.File,
): Promise<{ text: string; method: "text" | "multimodal" | "ocr" }> {
  const extension = path.extname(file.originalname).toLowerCase();

  if (supportedTextExtensions.has(extension)) {
    return { text: file.buffer.toString("utf-8"), method: "text" };
  }

  if (extension === ".pdf") {
    const result = await pdfParse(file.buffer);
    if (result.text.replace(/\s/g, "").length >= 80) {
      return { text: result.text, method: "text" };
    }

    // 扫描版 PDF，使用 AI 解析
    const aiResult = await extractPdfTextWithOcr(file.buffer);
    return aiResult;
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return { text: result.value, method: "text" };
  }

  throw new Error("仅支持 txt、md、csv、json、pdf 和 docx 文件。");
}

/** 在保留开头和结尾的前提下限制附件上下文，避免只丢失文档后半段。 */
function limitContextText(text: string, limit: number) {
  const normalized = text.trim();
  if (normalized.length <= limit) return normalized;
  const marker = "\n\n[中间内容已省略，仅保留文档开头和结尾]\n\n";
  const remaining = Math.max(0, limit - marker.length);
  const headLength = Math.ceil(remaining * 0.65);
  return (
    normalized.slice(0, headLength) +
    marker +
    normalized.slice(-(remaining - headLength))
  );
}

/** 解析单个文件并返回受控长度的聊天上下文，附带解析方式信息。 */
app.post("/api/files/parse", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: "请选择一个文件。" });
    return;
  }

  try {
    const { text, method } = await extractFileText(req.file);
    console.log(`📄 文件解析完成 [方法：${method}] ${req.file.originalname}`);

    res.json({
      fileName: req.file.originalname,
      text: limitContextText(text, maxFileContextChars),
      method, // 返回使用的解析方式，前端显示给用户
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件解析失败。";
    res.status(400).json({ message });
  }
});

/** 创建一次简历与 JD 匹配分析，并把结构化报告保存到 MongoDB。 */
app.post("/api/analyses", async (req, res) => {
  const { clientId, resumeFileName, resumeText, jdFileName, jdText } =
    req.body as {
      clientId?: string;
      resumeFileName?: string;
      resumeText?: string;
      jdFileName?: string;
      jdText?: string;
    };

  if (!clientId || !resumeFileName || !resumeText?.trim() || !jdText?.trim()) {
    res.status(400).json({ message: "请提供客户端标识、简历内容和 JD 内容。" });
    return;
  }

  try {
    await connectDatabase();
    const report = await generateMatchReport(resumeText.trim(), jdText.trim());
    const analysis = await Analysis.create({
      clientId,
      resumeFileName,
      jdFileName,
      resumeText: resumeText.trim(),
      jdText: jdText.trim(),
      report,
    });

    res.status(201).json({
      id: analysis.id,
      report,
      createdAt: analysis.createdAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "匹配分析失败。";
    res.status(500).json({ message });
  }
});

/** 查询当前浏览器客户端最近保存的分析报告摘要。 */
app.get("/api/analyses", async (req, res) => {
  const clientId =
    typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (!clientId) {
    res.status(400).json({ message: "缺少客户端标识。" });
    return;
  }

  try {
    await connectDatabase();
    const analyses = await Analysis.find({ clientId })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("resumeFileName jdFileName report.matchScore createdAt")
      .lean();

    res.json(
      analyses.map((analysis) => ({
        id: analysis._id.toString(),
        resumeFileName: analysis.resumeFileName,
        jdFileName: analysis.jdFileName,
        matchScore: analysis.report.matchScore,
        createdAt: analysis.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "历史报告读取失败。";
    res.status(500).json({ message });
  }
});

/** 读取一份完整的历史分析报告。 */
app.get("/api/analyses/:id", async (req, res) => {
  const clientId =
    typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (!clientId) {
    res.status(400).json({ message: "缺少客户端标识。" });
    return;
  }

  try {
    await connectDatabase();
    const analysis = await Analysis.findOne({
      _id: req.params.id,
      clientId,
    }).lean();
    if (!analysis) {
      res.status(404).json({ message: "分析报告不存在。" });
      return;
    }

    res.json({
      id: analysis._id.toString(),
      resumeFileName: analysis.resumeFileName,
      jdFileName: analysis.jdFileName,
      report: analysis.report,
      createdAt: analysis.createdAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "报告读取失败。";
    res.status(500).json({ message });
  }
});

/** 删除一份历史分析报告。 */
app.delete("/api/analyses/:id", async (req, res) => {
  const clientId =
    typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (!clientId) {
    res.status(400).json({ message: "缺少客户端标识。" });
    return;
  }

  try {
    await connectDatabase();
    await Analysis.findOneAndDelete({ _id: req.params.id, clientId });
    res.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "报告删除失败。";
    res.status(500).json({ message });
  }
});

/** 返回当前浏览器在自然日内的八股检索免费额度。 */
app.get("/api/quiz/quota", async (req, res) => {
  const clientId =
    typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (!clientId) {
    res.status(400).json({ message: "缺少客户端标识。" });
    return;
  }

  try {
    await connectDatabase();
    const date = new Date().toISOString().slice(0, 10);
    const quota = await QuizQuota.findOne({ clientId, date }).lean();
    res.json({
      limit: dailyFreeLimit,
      used: quota?.used ?? 0,
      remaining: dailyFreeLimit - (quota?.used ?? 0),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "免费额度读取失败。";
    res.status(500).json({ message });
  }
});

/** 按岗位、公司与场景筛选题库，并基于命中题目生成八股解释。 */
app.post("/api/quiz/search", async (req, res) => {
  const { clientId, direction, query, company, scenario } = req.body as {
    clientId?: string;
    direction?: QuizDirection;
    query?: string;
    company?: string;
    scenario?: string;
  };
  const directions: QuizDirection[] = ["前端", "Node 环境", "AI 应用"];
  if (
    !clientId ||
    !directions.includes(direction as QuizDirection) ||
    !query?.trim()
  ) {
    res.status(400).json({ message: "请提供客户端标识、岗位方向和检索问题。" });
    return;
  }

  try {
    await connectDatabase();
    const date = new Date().toISOString().slice(0, 10);
    const quota = await QuizQuota.findOne({ clientId, date }).lean();
    if ((quota?.used ?? 0) >= dailyFreeLimit) {
      res.status(429).json({ message: "今日免费检索次数已用完。" });
      return;
    }

    const records = await searchQuestionBank({
      direction: direction as QuizDirection,
      query: query.trim(),
      company: company?.trim(),
      scenario: scenario?.trim(),
    });
    if (records.length === 0) {
      res.json({
        remaining: dailyFreeLimit - (quota?.used ?? 0),
        records: [],
        answer: "题库中暂未找到相关题目，请尝试更换技术关键词或筛选条件。",
      });
      return;
    }

    const answer = await generateQuizAnswer(query.trim(), records);
    const record = await QuizRecord.create({
      clientId,
      query: query.trim(),
      direction,
      company: company?.trim() || undefined,
      scenario: scenario?.trim() || undefined,
      records,
      answer,
    });
    const updatedQuota = await QuizQuota.findOneAndUpdate(
      { clientId, date },
      { $inc: { used: 1 } },
      { upsert: true, new: true },
    ).lean();
    res.status(201).json({
      searchId: record.id,
      records,
      answer,
      remaining: dailyFreeLimit - updatedQuota.used,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "八股检索失败。";
    res.status(500).json({ message });
  }
});

/** 查询当前浏览器最近的八股检索记录。 */
app.get("/api/quiz/records", async (req, res) => {
  const clientId =
    typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (!clientId) {
    res.status(400).json({ message: "缺少客户端标识。" });
    return;
  }

  try {
    await connectDatabase();
    const records = await QuizRecord.find({ clientId })
      .sort({ createdAt: -1 })
      .limit(30)
      .select("query direction company scenario records createdAt")
      .lean();
    res.json(
      records.map((record) => ({
        id: record._id.toString(),
        query: record.query,
        direction: record.direction,
        company: record.company,
        scenario: record.scenario,
        resultCount: record.records.length,
        createdAt: record.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "检索记录读取失败。";
    res.status(500).json({ message });
  }
});

/** 打开单条检索记录，恢复其题库命中结果与 AI 解释。 */
app.get("/api/quiz/records/:id", async (req, res) => {
  const clientId =
    typeof req.query.clientId === "string" ? req.query.clientId : "";
  if (!clientId) {
    res.status(400).json({ message: "缺少客户端标识。" });
    return;
  }

  try {
    await connectDatabase();
    const record = await QuizRecord.findOne({
      _id: req.params.id,
      clientId,
    }).lean();
    if (!record) {
      res.status(404).json({ message: "检索记录不存在。" });
      return;
    }
    res.json({
      id: record._id.toString(),
      query: record.query,
      direction: record.direction,
      company: record.company,
      scenario: record.scenario,
      records: record.records,
      answer: record.answer,
      createdAt: record.createdAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "检索记录读取失败。";
    res.status(500).json({ message });
  }
});

/** 手动保存当前八股检索对话，便于保留一轮或多轮学习记录。 */
app.post("/api/quiz/conversations", async (req, res) => {
  const { clientId, direction, messages } = req.body as {
    clientId?: string;
    direction?: QuizDirection;
    messages?: QuizMessage[];
  };
  if (
    !clientId ||
    !direction ||
    !Array.isArray(messages) ||
    messages.length === 0
  ) {
    res.status(400).json({ message: "请提供客户端标识、岗位方向和对话内容。" });
    return;
  }

  try {
    await connectDatabase();
    const firstQuestion =
      messages.find((message) => message.role === "user")?.content ??
      "八股检索对话";
    const conversation = await QuizConversation.create({
      clientId,
      direction,
      title: firstQuestion.slice(0, 24),
      messages,
    });
    res.status(201).json({ id: conversation.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "对话保存失败。";
    res.status(500).json({ message });
  }
});

/** 在保留首条消息和最近消息的前提下限制本次请求的聊天上下文。 */
function selectChatMessages(
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    fileName?: string;
    attachmentText?: string;
  }>,
) {
  if (messages.length === 0) return [];

  const firstMessage = messages[0];
  const latestMessage = messages[messages.length - 1];
  const selected =
    latestMessage === firstMessage
      ? [firstMessage]
      : [firstMessage, latestMessage];
  let usedChars = selected.reduce(
    (total, message) =>
      total + message.content.length + (message.attachmentText?.length ?? 0),
    0,
  );

  for (let index = messages.length - 2; index > 0; index -= 1) {
    const message = messages[index];
    const messageChars =
      message.content.length + (message.attachmentText?.length ?? 0);
    if (usedChars + messageChars > maxChatContextChars) continue;
    selected.splice(1, 0, message);
    usedChars += messageChars;
  }

  return selected;
}

/** 将单条客户端消息转换为发送给模型的文本。 */
function formatChatMessage(message: {
  role: "user" | "assistant";
  content: string;
  fileName?: string;
  attachmentText?: string;
}) {
  return message.attachmentText
    ? message.content +
        "\n\n[附件：" +
        (message.fileName ?? "未命名文件") +
        "]\n" +
        message.attachmentText
    : message.content;
}

/** 在总预算内优先保留首条消息、最近消息和较新的中间消息。 */
function fitChatContext(messages: ReturnType<typeof selectChatMessages>) {
  const formatted = messages.map((message) => ({
    role: message.role,
    content: formatChatMessage(message),
  }));
  if (formatted.length <= 1) {
    return formatted.map((message) => ({
      ...message,
      content: limitContextText(message.content, maxChatContextChars),
    }));
  }

  const firstBudget = Math.floor(maxChatContextChars / 3);
  const latestBudget = Math.floor(maxChatContextChars / 3);
  const first = {
    ...formatted[0],
    content: limitContextText(formatted[0].content, firstBudget),
  };
  const latest = {
    ...formatted[formatted.length - 1],
    content: limitContextText(
      formatted[formatted.length - 1].content,
      latestBudget,
    ),
  };
  let remaining =
    maxChatContextChars - first.content.length - latest.content.length;
  const middle: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (
    let index = formatted.length - 2;
    index > 0 && remaining > 0;
    index -= 1
  ) {
    const content = limitContextText(formatted[index].content, remaining);
    if (!content) continue;
    middle.unshift({ ...formatted[index], content });
    remaining -= content.length;
  }

  return [first, ...middle, latest];
}

/** 将客户端消息转换为 DeepSeek 聊天消息格式，并裁剪过长单条消息。 */
function buildDeepSeekMessages(
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    fileName?: string;
    attachmentText?: string;
  }>,
) {
  const systemPrompt = `你是“JD AI 工作台”的校招求职助理。优先基于用户提供的 JD 和附件回答。\n\n当用户要求分析 JD 时，请严格使用以下五个 Markdown 二级标题：\n## 岗位职责\n## 技术栈\n## 关键词\n## 项目准备建议\n## 可能面试问题\n\n建议务实、具体，不要虚构岗位信息。`;
  return [
    { role: "system", content: systemPrompt },
    ...fitChatContext(selectChatMessages(messages)),
  ];
}

/** 代理 DeepSeek 的流式响应，使浏览器无法看到 API 密钥。 */
app.post("/api/chat", async (req, res) => {
  const { model, messages } = req.body as {
    model?: "deepseek-chat" | "deepseek-reasoner";
    messages?: Array<{
      role: "user" | "assistant";
      content: string;
      fileName?: string;
      attachmentText?: string;
    }>;
  };

  if (!process.env.DEEPSEEK_API_KEY) {
    res.status(500).json({ message: "服务端未配置 DEEPSEEK_API_KEY。" });
    return;
  }

  if (!model || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ message: "模型或消息参数缺失。" });
    return;
  }

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: buildDeepSeekMessages(messages),
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      res
        .status(response.status)
        .json({ message: detail || "DeepSeek 请求失败。" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    Readable.fromWeb(response.body as never).pipe(res);
  } catch {
    res.status(500).json({ message: "无法连接 DeepSeek 服务。" });
  }
});

app.listen(port, () => {
  console.log(`JD AI API is running at http://localhost:${port}`);
});
