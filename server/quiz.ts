import type { QuizDirection, QuizQuestion as QuizQuestionResult } from "../src/types";
import { QuizQuestion } from "./models/QuizQuestion";
import { loadSeedQuestions, normalizeSeedQuestion } from "./data/quizSeed";

const dailyFreeLimit = 10;
const vectorScoreThreshold = 0.75;
const maxKeywordBoost = 0.15;
const searchStopWords = new Set(["的", "了", "是", "在", "中", "和", "与", "及", "或", "什么", "怎么", "如何", "请", "一下"]);

type SearchOptions = {
  direction: QuizDirection;
  query: string;
  company?: string;
  scenario?: string;
};

/** 在题库为空时写入经过审核的官方来源种子题目。 */
export async function ensureQuestionBank() {
  if (await QuizQuestion.exists({})) return;
  await QuizQuestion.insertMany(loadSeedQuestions().map(normalizeSeedQuestion));
}

/** 使用 .env 配置的国内嵌入服务生成题库与查询向量。 */
async function createEmbedding(input: string) {
  const apiKey = process.env.EMBEDDING_API_KEY;
  const baseUrl = process.env.EMBEDDING_BASE_URL;
  const model = process.env.EMBEDDING_MODEL;
  if (!apiKey || !baseUrl || !model) return null;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) throw new Error("嵌入向量生成失败。");
  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0]?.embedding ?? null;
}

/** 为未向量化的题目生成嵌入，供 Atlas Vector Search 使用。 */
async function indexMissingEmbeddings() {
  if (!process.env.EMBEDDING_API_KEY || !process.env.EMBEDDING_BASE_URL || !process.env.EMBEDDING_MODEL) return;
  const questions = await QuizQuestion.find({
    status: "approved",
    $or: [{ embedding: { $exists: false } }, { embedding: { $size: 0 } }],
  }).select("question answer tags").lean();
  for (const question of questions) {
    const embedding = await createEmbedding(`${question.question}\n${question.answer}\n${question.tags.join(" ")}`);
    if (embedding) await QuizQuestion.updateOne({ _id: question._id }, { $set: { embedding } });
  }
}

/** 对中英文检索文本分词，并移除不影响题目语义的常见词。 */
function segmentSearchTerms(input: string) {
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  return [...new Set(
    [...segmenter.segment(input.toLowerCase())]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment.trim())
      .filter((term) => term.length > 1 && !searchStopWords.has(term)),
  )];
}

/** 根据候选题中的精确词命中比例计算最多 0.15 的排序加权。 */
function keywordBoost(question: QuizQuestionDocument, terms: string[]) {
  if (terms.length === 0) return 0;
  const searchable = [question.question, question.answer, ...question.tags, ...question.companies, ...question.scenarios].join(" ").toLowerCase();
  const matchedTerms = terms.filter((term) => searchable.includes(term)).length;
  return (matchedTerms / terms.length) * maxKeywordBoost;
}

/** 使用 Atlas Vector Search 召回语义相关题目，并保留向量相似度。 */
async function vectorSearch(options: SearchOptions) {
  const embedding = await createEmbedding([options.query, options.company, options.scenario].filter(Boolean).join(" "));
  if (!embedding) throw new Error("服务端未配置 embedding 模型。");
  try {
    return await QuizQuestion.aggregate([
      {
        $vectorSearch: {
          index: process.env.MONGODB_VECTOR_INDEX ?? "quiz_question_embedding",
          path: "embedding",
          queryVector: embedding,
          numCandidates: 100,
          limit: 20,
          filter: { status: "approved", direction: options.direction },
        },
      },
      { $project: { score: { $meta: "vectorSearchScore" }, question: 1, answer: 1, followUps: 1, pitfalls: 1, direction: 1, tags: 1, companies: 1, scenarios: 1, difficulty: 1, source: 1 } },
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    throw new Error(`Atlas 向量检索失败，请确认 quizquestions 集合的向量索引配置。${detail}`);
  }
}

/** 以向量结果为候选集，通过精确关键词加权后返回高相关题目。 */
export async function searchQuestionBank(options: SearchOptions): Promise<QuizQuestionResult[]> {
  await ensureQuestionBank();
  await indexMissingEmbeddings();
  const terms = segmentSearchTerms([options.query, options.company, options.scenario].filter(Boolean).join(" "));
  const vectorResults = await vectorSearch(options);
  return vectorResults
    .filter((question) => question.score >= vectorScoreThreshold)
    .map((question) => {
      const boost = keywordBoost(question, terms);
      return { question, boost, score: question.score + boost };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ question, boost }) => ({
      id: question._id.toString(),
      question: question.question,
      answer: question.answer,
      followUps: question.followUps,
      pitfalls: question.pitfalls,
      direction: question.direction,
      tags: question.tags,
      companies: question.companies,
      scenarios: question.scenarios,
      difficulty: question.difficulty,
      source: question.source,
      matchType: boost > 0 ? "混合" : "向量",
    }));
}

/** 只基于检索命中的题目与官方来源生成可读的八股解释。 */
export async function generateQuizAnswer(query: string, records: QuizQuestionResult[]) {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error("服务端未配置 DEEPSEEK_API_KEY。");
  const context = records.map((record, index) => `${index + 1}. ${record.question}\n答案：${record.answer}\n追问：${record.followUps.join("；")}\n易错点：${record.pitfalls.join("；")}\n来源：${record.source.title} ${record.source.url}`).join("\n\n");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.2,
      messages: [
        { role: "system", content: "你是八股题检索助手。只能依据提供的题库内容回答，不得编造题目或来源。用 Markdown 输出：先给出检索结论，再按题目列出标准回答、可追问点、易错点和参考来源。" },
        { role: "user", content: `用户问题：${query}\n\n检索题库：\n${context}` },
      ],
    }),
  });
  if (!response.ok) throw new Error("DeepSeek 八股解释生成失败。");
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "未生成八股解释。";
}

export { dailyFreeLimit };
