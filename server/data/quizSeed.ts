import { readFileSync } from "node:fs";
import type { QuizQuestionDocument } from "../models/QuizQuestion";

export type SeedQuizQuestion = Omit<QuizQuestionDocument, "embedding">;

/** 从独立 JSON 文件读取题库数据，供服务端初始化和导入脚本复用。 */
export function loadSeedQuestions(): SeedQuizQuestion[] {
  const data = readFileSync(new URL("./quiz-seed.json", import.meta.url), "utf-8");
  return JSON.parse(data) as SeedQuizQuestion[];
}

/** 清洗题目文本和标签，确保 JSON 数据写入数据库前格式稳定。 */
export function normalizeSeedQuestion(question: SeedQuizQuestion): SeedQuizQuestion {
  const normalizeList = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return {
    ...question,
    question: question.question.replace(/\s+/g, " ").trim(),
    answer: question.answer.replace(/\s+/g, " ").trim(),
    tags: normalizeList(question.tags),
    companies: normalizeList(question.companies),
    scenarios: normalizeList(question.scenarios),
  };
}
