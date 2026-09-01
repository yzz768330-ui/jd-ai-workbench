export type Model = "deepseek-chat" | "deepseek-reasoner";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  fileName?: string;
  attachmentText?: string;
};

export type Session = {
  id: string;
  title: string;
  model: Model;
  messages: Message[];
  updatedAt: number;
};

export type ParsedFile = {
  fileName: string;
  text: string;
};

/** 简历与 JD 匹配报告中的单项技能信息。 */
export type SkillMatch = {
  name: string;
  category: string;
  importance: string;
  score: number;
  evidence: string;
  gap: string;
};

/** LangChain 返回并由前端报告页消费的结构化分析结果。 */
export type MatchReport = {
  summary: string;
  matchScore: number;
  scoreBreakdown: Array<{ category: string; score: number }>;
  skills: SkillMatch[];
  missingSkills: string[];
  interviewQuestions: Array<{ question: string; reason: string; difficulty: string }>;
  actionPlan: string[];
};

/** 历史报告列表使用的轻量记录。 */
export type AnalysisHistoryItem = {
  id: string;
  resumeFileName: string;
  jdFileName?: string;
  matchScore: number;
  createdAt: string;
};

export type QuizDirection = "前端" | "Node 环境" | "AI 应用";

export type QuizQuestion = {
  id: string;
  question: string;
  answer: string;
  followUps: string[];
  pitfalls: string[];
  direction: QuizDirection;
  tags: string[];
  companies: string[];
  scenarios: string[];
  difficulty: "基础" | "进阶" | "高阶";
  source: { title: string; url: string };
  matchType: "关键词" | "向量" | "混合";
};

export type QuizMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type QuizSearchResponse = {
  remaining: number;
  records: QuizQuestion[];
  answer: string;
  searchId: string;
};

export type QuizHistoryItem = {
  id: string;
  query: string;
  direction: QuizDirection;
  company?: string;
  scenario?: string;
  resultCount: number;
  createdAt: string;
};
