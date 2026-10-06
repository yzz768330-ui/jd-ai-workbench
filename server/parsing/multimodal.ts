/**
 * 多模态 AI PDF 解析模块
 * 支持 Qwen-VL、GPT-4o、Claude 3.5 等多模态模型
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

interface MultimodalOptions {
  model?: "qwen-vl" | "gpt-4o" | "claude-3.5";
  maxPages?: number;
}

const DEFAULT_MAX_PAGES = 10;

/** 将 PDF 页面转换为 Base64 图片 */
async function pdfPageToBase64(
  pdf: any,
  pageNumber: number,
  scale: number = 2.0,
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  const ctx = canvas.getContext("2d");

  await page.render({
    canvasContext: ctx as never,
    viewport,
  }).promise;

  return canvas.toBuffer("image/png").toString("base64");
}

/**
 * Qwen-VL 多模态解析（推荐）
 * 优势：中文识别好、成本低、支持长上下文
 */
export async function parsePdfWithQwenVL(
  buffer: Buffer,
  options: MultimodalOptions = {},
): Promise<string> {
  const { maxPages = DEFAULT_MAX_PAGES } = options;
  const apiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    throw new Error("未配置 QWEN_API_KEY 或 DASHSCOPE_API_KEY");
  }

  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: Array<{ image: string; text: string }> = [];

  try {
    // 逐页解析，避免超过 token 限制
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const base64Image = await pdfPageToBase64(pdf, i);

      const response = await fetch(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "qwen2-vl-72b-instruct",
            input: {
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      image: `data:image/png;base64,${base64Image}`,
                      format: "png",
                    },
                    {
                      text: "你是一名专业的文档分析助手。请仔细提取这份文档的所有文字内容。如果是求职岗位 JD，请按以下格式输出：\n\n## 岗位职责\n详细描述工作内容\n\n## 技术要求\n列出所有技术栈和工具\n\n## 关键词\n提取核心技能关键词\n\n## 项目建议\n根据岗位要求给出项目准备建议\n\n## 可能面试问题\n列出 3-5 个可能被问到的技术问题\n\n如果文档类型不是 JD，请提取所有文本并保持原始结构。",
                    },
                  ],
                },
              ],
            },
            parameters: {
              temperature: 0.1,
              max_tokens: 4000,
              result_format: "text",
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Qwen-VL API 请求失败：${response.status}`);
      }

      const result = await response.json();
      pages.push({
        image: base64Image,
        text: result.output?.text || "",
      });
    }

    return pages.map((p) => p.text).join("\n\n--- 分页结束 ---\n\n");
  } catch (error) {
    console.error("Qwen-VL 解析失败:", error);
    throw error;
  } finally {
    await pdf.destroy();
  }
}

/**
 * GPT-4o 多模态解析（效果最佳但成本高）
 */
export async function parsePdfWithGPT4O(
  buffer: Buffer,
  options: MultimodalOptions = {},
): Promise<string> {
  const { maxPages = DEFAULT_MAX_PAGES } = options;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("未配置 OPENAI_API_KEY");
  }

  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  try {
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const base64Image = await pdfPageToBase64(pdf, i);

      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${base64Image}`,
                    },
                  },
                  {
                    type: "text",
                    text: "Extract all text from this document preserving structure, headings, and lists. If it's a job description, organize it into sections: Responsibilities, Requirements, Tech Stack, Keywords.",
                  },
                ],
              },
            ],
            max_tokens: 2000,
            temperature: 0.1,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`GPT-4o API 请求失败：${response.status}`);
      }

      const data = await response.json();
      pages.push(data.choices?.[0]?.message?.content || "");
    }

    return pages.join("\n\n--- Page Break ---\n\n");
  } catch (error) {
    console.error("GPT-4o 解析失败:", error);
    throw error;
  } finally {
    await pdf.destroy();
  }
}

/**
 * Claude 3.5 Sonnet 多模态解析（平衡方案）
 * 优势：原生支持 PDF 输入，无需转图片
 */
export async function parsePdfWithClaude(
  buffer: Buffer,
  options: MultimodalOptions = {},
): Promise<string> {
  const { maxPages = 8 } = options;
  const apiKey = process.env.CLAUDE_API_KEY;

  if (!apiKey) {
    throw new Error("未配置 CLAUDE_API_KEY");
  }

  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;

  try {
    // Claude 支持直接上传 PDF（beta 特性），这里先用图片方式
    const base64Images = [];
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const base64Image = await pdfPageToBase64(pdf, i);
      base64Images.push(base64Image);
    }

    const content = [
      ...base64Images.map((img) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: "image/png",
          data: img.split(",")[1], // 去掉 data:image/png;base64, 前缀
        },
      })),
      {
        type: "text" as const,
        text: `You are a professional document analyzer. Extract all text from these PDF pages with high accuracy.\n\nIf the document is a Job Description, organize your output as follows:\n\n### Job Responsibilities\n[List of responsibilities]\n\n### Technical Requirements\n[List of technologies, tools, frameworks]\n\n### Key Skills\n[Bullet points of must-have skills]\n\n### Project Recommendations\n[Suggestions for relevant projects]\n\n### Potential Interview Questions\n[3-5 technical questions likely to be asked]\n\nIf not a JD, extract all text preserving original formatting, tables, and lists.`,
      },
    ];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdf-2023-10-31",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        temperature: 0.1,
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API 请求失败：${response.status}`);
    }

    const result = await response.json();
    return result.content?.[0]?.text || "";
  } catch (error) {
    console.error("Claude 解析失败:", error);
    throw error;
  } finally {
    await pdf.destroy();
  }
}

/**
 * 智能选择多模态模型解析
 * 策略：按优先级尝试，失败降级到下一个模型
 */
export async function parsePdfWithMultimodalAI(
  buffer: Buffer,
  options: MultimodalOptions & {
    preferredModel?: "auto" | "qwen-vl" | "gpt-4o" | "claude-3.5";
  } = {},
): Promise<{ text: string; method: string }> {
  const { preferredModel = "auto" } = options;

  let errors: Error[] = [];
  let lastError: Error | null = null;

  // 自动模式：按优先级尝试
  const modelsToTry =
    preferredModel === "auto"
      ? ["qwen-vl", "gpt-4o", "claude-3.5"]
      : [preferredModel || "qwen-vl"];

  for (const model of modelsToTry) {
    try {
      switch (model) {
        case "qwen-vl":
          const qwenResult = await parsePdfWithQwenVL(buffer, options);
          console.log("✅ 使用 Qwen-VL 成功解析");
          return { text: qwenResult, method: "qwen-vl" };

        case "gpt-4o":
          const gptResult = await parsePdfWithGPT4O(buffer, options);
          console.log("✅ 使用 GPT-4o 成功解析");
          return { text: gptResult, method: "gpt-4o" };

        case "claude-3.5":
          const claudeResult = await parsePdfWithClaude(buffer, options);
          console.log("✅ 使用 Claude 3.5 成功解析");
          return { text: claudeResult, method: "claude-3.5" };
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);
      lastError = err;
      console.warn(`⚠️ ${model} 解析失败：${err.message}`);
    }
  }

  // 全部失败
  throw new Error(
    `所有多模态模型解析失败：${errors.map((e) => e.message).join("; ")}`,
  );
}
