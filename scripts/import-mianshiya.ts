// 批量导入MongoDB 的脚本
import dotenv from "dotenv";
import mongoose from "mongoose";
import dns from "node:dns";
import {
  QuizQuestion,
  type QuizQuestionDocument,
} from "../server/models/QuizQuestion";
import type { QuizDirection } from "../src/types";

dotenv.config();

const sourceBaseUrl = "https://www.mianshiya.com";
const defaultTags = ["Vue", "JavaScript", "HTML", "CSS", "React", "Agent"];
const pageSize = 20;
const requestDelayMs = 250;
const requestRetryCount = 3;
const requestHeaders = {
  "User-Agent": "Mozilla/5.0 (compatible; JD-AI-Workbench importer)",
  Accept: "text/html,application/xhtml+xml",
};

type SourceQuestion = {
  id: string;
  question: string;
  difficulty: QuizQuestionDocument["difficulty"];
  tags: string[];
  url: string;
};

type ImportOptions = {
  tags: string[];
  limitPerTag: number;
  withEmbeddings: boolean;
};

/** 将网页中的常见 HTML 实体还原为可检索文本。 */
function decodeHtml(value: string) {
  const namedEntities: Record<string, string> = {
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": " ",
  };
  return value
    .replace(
      /&(?:amp|quot|#39|lt|gt|nbsp);/g,
      (entity) => namedEntities[entity] ?? entity,
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .trim();
}

/** 清理题目和答案中的 HTML 标签、重复空白与网页控制字符。 */
function cleanText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

/** 将面试鸭页面的中文难度映射到本项目的固定枚举。 */
function mapDifficulty(value: string): QuizQuestionDocument["difficulty"] {
  if (value.includes("简单") || value.includes("基础")) return "基础";
  if (value.includes("困难") || value.includes("高阶")) return "高阶";
  return "进阶";
}

/** 等待一小段时间，避免连续请求给来源站点造成压力。 */
function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 对来源站点的偶发连接中断进行少量重试。 */
async function fetchSource(url: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= requestRetryCount; attempt += 1) {
    try {
      const response = await fetch(url, { headers: requestHeaders });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < requestRetryCount) await delay(1000 * attempt);
  }
  throw new Error(
    `请求来源页面失败：${url}；${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** 从标签列表页提取题目链接、难度和标签。 */
function parseTagPage(html: string): SourceQuestion[] {
  const questions: SourceQuestion[] = [];
  const rowPattern = /<tr[^>]*data-row-key="(?<id>\d+)"[\s\S]*?<\/tr>/g;
  for (const rowMatch of html.matchAll(rowPattern)) {
    const row = rowMatch[0];
    const questionMatch = row.match(
      /href="\/question\/(?<id>\d+)"[^>]*>(?<question>[\s\S]*?)<\/a>/,
    );
    if (!questionMatch?.groups) continue;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(
      (match) => match[1],
    );
    const tags = [
      ...row.matchAll(
        /href="\/tag\/[^"?]+"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/g,
      ),
    ]
      .map((match) => cleanText(match[1]))
      .filter(Boolean);
    const id = questionMatch.groups.id;
    questions.push({
      id,
      question: cleanText(questionMatch.groups.question),
      difficulty: mapDifficulty(cleanText(cells[1] ?? "")),
      tags: [...new Set(tags)],
      url: `${sourceBaseUrl}/question/${id}`,
    });
  }
  return questions;
}

/** 从题目详情页的 JSON-LD 中读取标准答案和关键词，无公开题解时返回 null。 */
async function fetchQuestionAnswer(question: SourceQuestion) {
  const response = await fetchSource(question.url);
  const html = await response.text();
  const scripts = [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ];
  for (const script of scripts) {
    try {
      const data = JSON.parse(script[1]) as unknown;
      const entities = Array.isArray(data) ? data : [data];
      const questionEntity = entities.find(
        (
          item,
        ): item is {
          mainEntity?: {
            acceptedAnswer?: { text?: string };
            keywords?: string;
          };
        } => Boolean(item && typeof item === "object" && "mainEntity" in item),
      );
      const answer = questionEntity?.mainEntity?.acceptedAnswer?.text;
      if (answer) {
        const keywordTags =
          questionEntity.mainEntity?.keywords
            ?.split(",")
            .map((tag) => cleanText(tag))
            .filter(Boolean) ?? [];
        return {
          answer: cleanText(answer),
          tags: [...new Set([...question.tags, ...keywordTags])],
        };
      }
    } catch {
      // 页面可能包含其他非 JSON-LD 脚本，跳过即可。
    }
  }
  return null;
}

/** 分页读取一个技术标签下的公开题目。 */
async function fetchTagQuestions(tag: string, limit: number) {
  const questions = new Map<string, SourceQuestion>();
  for (let current = 1; questions.size < limit; current += 1) {
    const url = `${sourceBaseUrl}/tag/${encodeURIComponent(tag)}?current=${current}&pageSize=${pageSize}`;
    const response = await fetchSource(url);
    const pageQuestions = parseTagPage(await response.text());
    if (pageQuestions.length === 0) break;
    for (const question of pageQuestions) {
      questions.set(question.id, question);
      if (questions.size >= limit) break;
    }
    if (pageQuestions.length < pageSize) break;
    await delay(requestDelayMs);
  }
  return [...questions.values()];
}

/** 使用配置的嵌入服务生成向量，供 MongoDB Atlas Vector Search 使用。 */
async function createEmbedding(input: string) {
  const {
    EMBEDDING_API_KEY: apiKey,
    EMBEDDING_BASE_URL: baseUrl,
    EMBEDDING_MODEL: model,
  } = process.env;
  if (!apiKey || !baseUrl || !model) return null;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) throw new Error(`嵌入服务请求失败：${response.status}`);
  const data = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  return data.data?.[0]?.embedding ?? null;
}

/** 将来源题目转换成当前项目的 QuizQuestion 文档。 */
function toQuizQuestion(
  source: SourceQuestion,
  details: { answer: string; tags: string[] },
  direction: QuizDirection,
) {
  const tags = [
    ...new Set(details.tags.map((tag) => tag.trim()).filter(Boolean)),
  ];
  return {
    question: source.question,
    answer: details.answer,
    followUps: [],
    pitfalls: [],
    direction,
    tags,
    companies: [],
    scenarios: tags,
    difficulty: source.difficulty,
    source: { title: "面试鸭", url: source.url },
    status: "approved" as const,
  };
}

/** 解析命令行参数，控制标签范围、每类数量和是否生成 embedding。 */
function parseOptions(): ImportOptions {
  const args = process.argv.slice(2);
  const valueAfter = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const tags =
    valueAfter("--tags")
      ?.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean) ?? defaultTags;
  const parsedLimit = Number(valueAfter("--limit-per-tag") ?? "100");
  return {
    tags,
    limitPerTag:
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100,
    withEmbeddings: !args.includes("--skip-embeddings"),
  };
}

/** 连接 MongoDB 并按来源 URL 幂等导入题目，最后输出导入统计。 */
async function main() {
  const options = parseOptions();
  const dnsServers = (process.env.MONGODB_DNS_SERVERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (dnsServers.length > 0) dns.setServers(dnsServers);
  await mongoose.connect(
    process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/jd-ai-workbench",
    {
      dbName: process.env.MONGODB_DB_NAME ?? "jd-ai-workbench",
      serverSelectionTimeoutMS: 10000,
    },
  );

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  try {
    await QuizQuestion.updateMany(
      { "source.title": "面试鸭", answer: "请参考来源页面中的题解。" },
      { $set: { status: "draft" } },
    );
    for (const tag of options.tags) {
      const direction = tag === "Agent" ? "AI 应用" : "前端";
      const sourceQuestions = await fetchTagQuestions(tag, options.limitPerTag);
      console.log(`${tag}: 找到 ${sourceQuestions.length} 道题目`);
      for (const sourceQuestion of sourceQuestions) {
        const details = await fetchQuestionAnswer(sourceQuestion);
        if (!details) {
          skipped += 1;
          continue;
        }
        const document = toQuizQuestion(sourceQuestion, details, direction);
        const existing = await QuizQuestion.findOne({
          "source.url": sourceQuestion.url,
        })
          .select("embedding")
          .lean();
        const update: Record<string, unknown> = { $set: document };
        if (options.withEmbeddings && !existing?.embedding?.length) {
          const embedding = await createEmbedding(
            `${document.question}\n${document.answer}\n${document.tags.join(" ")}`,
          );
          if (embedding)
            (update.$set as Record<string, unknown>).embedding = embedding;
        }
        await QuizQuestion.updateOne(
          { "source.url": sourceQuestion.url },
          update,
          { upsert: true },
        );
        if (existing) updated += 1;
        else imported += 1;
        await delay(requestDelayMs);
      }
    }
  } finally {
    await mongoose.disconnect();
  }
  console.log(
    `导入完成：新增 ${imported} 道，更新 ${updated} 道，跳过无公开题解 ${skipped} 道。`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
