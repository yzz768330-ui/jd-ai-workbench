import mongoose, { Schema } from "mongoose";
import type { QuizDirection } from "../../src/types";

//保存正式题库内容
export type QuizQuestionDocument = {
  question: string; // 题目
  answer: string; //标准答案
  followUps: string[]; //可追问方向
  pitfalls: string[]; //易错点
  direction: QuizDirection; //岗位方向
  tags: string[]; //技术标签 vue、js\react
  companies: string[]; //相关公司(可选)
  scenarios: string[]; //面试场景(可选)
  difficulty: "基础" | "进阶" | "高阶"; //难度
  source: { title: string; url: string }; //来源名称和 URL
  embedding?: number[]; //向量
  status: "draft" | "approved" | "rejected";
};

const quizQuestionSchema = new Schema<QuizQuestionDocument>({
  question: { type: String, required: true },
  answer: { type: String, required: true },
  followUps: { type: [String], default: [] },
  pitfalls: { type: [String], default: [] },
  direction: { type: String, required: true, index: true },
  tags: { type: [String], default: [], index: true },
  companies: { type: [String], default: [] },
  scenarios: { type: [String], default: [] },
  difficulty: { type: String, required: true },
  source: {
    title: { type: String, required: true },
    url: { type: String, required: true },
  },
  embedding: { type: [Number], select: false },
  status: { type: String, required: true, default: "approved", index: true },
});

export const QuizQuestion = mongoose.model<QuizQuestionDocument>(
  "QuizQuestion",
  quizQuestionSchema,
);
