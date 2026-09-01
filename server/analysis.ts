import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import type { MatchReport } from "../src/types";

const matchReportSchema = z.object({
  summary: z.string(),
  matchScore: z.number().min(0).max(100),
  scoreBreakdown: z.array(
    z.object({ category: z.string(), score: z.number().min(0).max(100) }),
  ),
  skills: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      importance: z.string(),
      score: z.number().min(0).max(100),
      evidence: z.string(),
      gap: z.string(),
    }),
  ),
  missingSkills: z.array(z.string()),
  interviewQuestions: z.array(
    z.object({
      question: z.string(),
      reason: z.string(),
      difficulty: z.string(),
    }),
  ),
  actionPlan: z.array(z.string()),
});

/** 调用 DeepSeek 并要求模型返回可直接用于图表和页面渲染的 JSON。 */
export async function generateMatchReport(
  resumeText: string,
  jdText: string,
): Promise<MatchReport> {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("服务端未配置 DEEPSEEK_API_KEY。");
  }

  // 使用 LangChain 的 ChatOpenAI 与 DeepSeek 对接
  //temperature: 0.2 使输出更稳定，减少随机性，这对结构化输出至关重要
  const model = new ChatOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_ANALYSIS_MODEL ?? "deepseek-chat",
    temperature: 0.2,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    },
  });

  const structuredModel = model.withStructuredOutput(matchReportSchema, {
    name: "jd_match_report",
    method: "jsonMode",
  });

  const result = await structuredModel.invoke([
    {
      role: "system",
      content: `你是校招求职分析助手。只根据输入的简历和 JD 判断，不要虚构经历。

只能返回一个 JSON 对象，不要返回 Markdown、代码块或任何额外字段。JSON 必须严格包含以下字段；下面的示例值仅表示类型，实际内容要根据简历和 JD 生成：
{
  "summary": "string，整体匹配结论",
  "matchScore": 0,
  "scoreBreakdown": [{ "category": "能力维度名称", "score": 0 }],
  "skills": [{ "name": "技能名称", "category": "技能类别", "importance": "高", "score": 0, "evidence": "必须引用简历已有内容", "gap": "具体缺口；没有缺口时写无" }],
  "missingSkills": ["string，缺失技能"],
  "interviewQuestions": [{ "question": "string，面试问题", "reason": "string，提问原因", "difficulty": "string，例如初级/中级/高级" }],
  "actionPlan": ["string，可执行的准备建议"]
}

不要使用 strengths、gaps、recommendations 等其他字段名。matchScore、scoreBreakdown 中的 score 和 skills 中的 score 都必须是 0 到 100 的数字。`,
    },
    {
      role: "user",
      content: `请分析下面的简历和岗位 JD，并生成匹配报告。\n\n【简历】\n${resumeText}\n\n【JD】\n${jdText}`,
    },
  ]);

  return result as MatchReport;
}
