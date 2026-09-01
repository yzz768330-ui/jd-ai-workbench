import dns from "node:dns";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { QuizQuestion } from "../server/models/QuizQuestion";
import { loadSeedQuestions, normalizeSeedQuestion } from "../server/data/quizSeed";

dotenv.config();

/** 使用配置的嵌入服务生成题目向量。 */
async function createEmbedding(input: string) {
  const { EMBEDDING_API_KEY: apiKey, EMBEDDING_BASE_URL: baseUrl, EMBEDDING_MODEL: model } = process.env;
  if (!apiKey || !baseUrl || !model) return null;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) throw new Error(`嵌入服务请求失败：${response.status}`);
  const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  return data.data?.[0]?.embedding ?? null;
}

/** 读取命令行参数，允许线上只同步 JSON 文本而跳过向量生成。 */
function shouldSkipEmbeddings() {
  return process.argv.includes("--skip-embeddings");
}

/** 按来源 URL 幂等同步外置种子题库，避免重新发布服务端代码。 */
async function main() {
  const dnsServers = (process.env.MONGODB_DNS_SERVERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (dnsServers.length > 0) dns.setServers(dnsServers);

  await mongoose.connect(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/jd-ai-workbench", {
    dbName: process.env.MONGODB_DB_NAME ?? "jd-ai-workbench",
    serverSelectionTimeoutMS: 10000,
  });

  let imported = 0;
  let updated = 0;
  try {
    for (const rawQuestion of loadSeedQuestions()) {
      const question = normalizeSeedQuestion(rawQuestion);
      const existing = await QuizQuestion.findOne({ "source.url": question.source.url })
        .select("question answer tags embedding")
        .lean();
      const update: Record<string, unknown> = { $set: question };
      const embeddingInputChanged = !existing
        || existing.question !== question.question
        || existing.answer !== question.answer
        || JSON.stringify(existing.tags) !== JSON.stringify(question.tags);
      if (!shouldSkipEmbeddings() && (embeddingInputChanged || !existing.embedding?.length)) {
        const embedding = await createEmbedding(`${question.question}\n${question.answer}\n${question.tags.join(" ")}`);
        if (embedding) (update.$set as Record<string, unknown>).embedding = embedding;
      } else if (shouldSkipEmbeddings() && embeddingInputChanged) {
        update.$unset = { embedding: 1 };
      }

      await QuizQuestion.updateOne({ "source.url": question.source.url }, update, { upsert: true });
      if (existing) updated += 1;
      else imported += 1;
    }
  } finally {
    await mongoose.disconnect();
  }

  console.log(`种子题库同步完成：新增 ${imported} 道，更新 ${updated} 道。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
