import mongoose, { Schema } from "mongoose";
import type { QuizDirection, QuizMessage, QuizQuestion } from "../../src/types";


//对每次成功检索后的每一条保存记录
export type QuizRecordDocument = {
  clientId: string;  //这里还是浏览器第一次打开的时候生成的uuid
  query: string;   //用户输入的原始的问题
  direction: QuizDirection;  //岗位方向（必填，默认前端）
  company?: string;   //公司和筛选条件
  scenario?: string;   //
  records: QuizQuestion[];
  answer: string;
  createdAt: Date;
  updatedAt: Date;
};

const quizRecordSchema = new Schema<QuizRecordDocument>(
  {
    clientId: { type: String, required: true, index: true },
    query: { type: String, required: true },
    direction: { type: String, required: true },
    company: String,
    scenario: String,
    records: { type: [Schema.Types.Mixed], default: [] },
    answer: { type: String, required: true },
  },
  { timestamps: true },
);

export const QuizRecord = mongoose.model<QuizRecordDocument>("QuizRecord", quizRecordSchema);

export type QuizConversationDocument = {
  clientId: string;
  title: string;
  direction: QuizDirection;
  messages: QuizMessage[];
  createdAt: Date;
  updatedAt: Date;
};

const quizConversationSchema = new Schema<QuizConversationDocument>(
  {
    clientId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    direction: { type: String, required: true },
    messages: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

export const QuizConversation = mongoose.model<QuizConversationDocument>("QuizConversation", quizConversationSchema);

type QuizQuotaDocument = {
  clientId: string;
  date: string;
  used: number;
};

const quizQuotaSchema = new Schema<QuizQuotaDocument>({
  clientId: { type: String, required: true },
  date: { type: String, required: true },
  used: { type: Number, required: true, default: 0 },
});

quizQuotaSchema.index({ clientId: 1, date: 1 }, { unique: true });

export const QuizQuota = mongoose.model<QuizQuotaDocument>("QuizQuota", quizQuotaSchema);
