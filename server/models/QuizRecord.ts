import mongoose, { Schema } from "mongoose";
import type { QuizDirection, QuizMessage, QuizQuestion } from "../../src/types";

export type QuizRecordDocument = {
  clientId: string;
  query: string;
  direction: QuizDirection;
  company?: string;
  scenario?: string;
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
