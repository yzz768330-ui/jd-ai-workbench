import mongoose, { Schema } from "mongoose";
import type { MatchReport } from "../../src/types";

//结构化报告生成（一次性），用langchain+ zod 最好不用用流式
export type AnalysisDocument = {
  clientId: string;
  resumeFileName: string;
  jdFileName?: string;
  resumeText: string;
  jdText: string;
  report: MatchReport;
  createdAt: Date;
  updatedAt: Date;
};

const analysisSchema = new Schema<AnalysisDocument>(
  {
    clientId: { type: String, required: true, index: true },
    resumeFileName: { type: String, required: true },
    jdFileName: String,
    resumeText: { type: String, required: true },
    jdText: { type: String, required: true },
    report: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

/** 保存一次简历与 JD 的匹配分析结果。 */
export const Analysis = mongoose.model<AnalysisDocument>(
  "Analysis",
  analysisSchema,
);
