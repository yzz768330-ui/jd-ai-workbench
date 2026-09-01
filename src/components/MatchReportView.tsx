import { FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import ReactECharts from "echarts-for-react";
import type { AnalysisHistoryItem, MatchReport } from "../types";

type MatchReportViewProps = {
  report: MatchReport | null;
  history: AnalysisHistoryItem[];
  resumeFileName: string;
  jdFileName: string;
  jdText: string;
  isLoading: boolean;
  error: string;
  onResumeFile: (file: File) => void;
  onJdFile: (file: File) => void;
  onJdTextChange: (value: string) => void;
  onAnalyze: () => void;
  onReset: () => void;
  onSelectHistory: (id: string) => void;
  onDeleteHistory: (id: string) => void;
};

/** 展示简历-JD 匹配输入区、历史报告和 ECharts 分析结果。 */
export function MatchReportView({
  report,
  history,
  resumeFileName,
  jdFileName,
  jdText,
  isLoading,
  error,
  onResumeFile,
  onJdFile,
  onJdTextChange,
  onAnalyze,
  onReset,
  onSelectHistory,
  onDeleteHistory,
}: MatchReportViewProps) {
  const radarOption = {
    tooltip: {},
    radar: {
      indicator: report?.scoreBreakdown.map((item) => ({ name: item.category, max: 100 })) ?? [],
      radius: "64%",
    },
    series: [
      {
        type: "radar",
        data: [{ value: report?.scoreBreakdown.map((item) => item.score) ?? [], name: "匹配度" }],
        areaStyle: { color: "rgba(27, 127, 117, 0.22)" },
        lineStyle: { color: "#1b7f75" },
        itemStyle: { color: "#1b7f75" },
      },
    ],
  };

  const gapOption = {
    tooltip: { trigger: "axis" },
    grid: { left: 96, right: 24, top: 18, bottom: 28 },
    xAxis: { type: "value", max: 100 },
    yAxis: {
      type: "category",
      data: report?.skills.slice(0, 8).map((skill) => skill.name).reverse() ?? [],
    },
    series: [
      {
        type: "bar",
        data: report?.skills.slice(0, 8).map((skill) => skill.score).reverse() ?? [],
        itemStyle: { color: "#328176" },
        barMaxWidth: 18,
      },
    ],
  };

  return (
    <section className="min-h-full bg-slate-50 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-teal-700">结构化 AI 分析</p>
            <h2 className="text-2xl font-bold text-slate-900">简历-JD 匹配报告</h2>
            <p className="mt-2 text-sm text-slate-500">上传简历并输入目标 JD，生成技能匹配度、缺口和面试准备建议。</p>
          </div>
          {report && <div className="flex items-center gap-3"><button type="button" onClick={onReset} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-teal-300 hover:text-teal-700">重新分析</button><div className="rounded-xl bg-teal-700 px-5 py-3 text-right text-white shadow-sm"><div className="text-xs opacity-80">综合匹配度</div><div className="text-3xl font-bold">{report.matchScore}<span className="text-base"> / 100</span></div></div></div>}
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-5">
            {!report && (
              <div className="grid gap-5 md:grid-cols-2">
                <label className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center transition hover:border-teal-500">
                  <Upload className="mx-auto mb-3 text-teal-700" size={24} />
                  <span className="block text-sm font-semibold text-slate-800">{resumeFileName || "上传简历"}</span>
                  <span className="mt-2 block text-xs text-slate-500">支持 PDF、DOCX、TXT 等格式</span>
                  <input className="hidden" type="file" accept=".txt,.md,.csv,.json,.pdf,.docx" onChange={(event) => event.target.files?.[0] && onResumeFile(event.target.files[0])} />
                </label>
                <label className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center transition hover:border-teal-500">
                  <FileText className="mx-auto mb-3 text-teal-700" size={24} />
                  <span className="block text-sm font-semibold text-slate-800">{jdFileName || "上传 JD（可选）"}</span>
                  <span className="mt-2 block text-xs text-slate-500">也可以直接在下方粘贴岗位描述</span>
                  <input className="hidden" type="file" accept=".txt,.md,.csv,.json,.pdf,.docx" onChange={(event) => event.target.files?.[0] && onJdFile(event.target.files[0])} />
                </label>
              </div>
            )}

            {!report && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <label className="mb-2 block text-sm font-semibold text-slate-800" htmlFor="match-jd">目标岗位 JD</label>
                <textarea id="match-jd" value={jdText} onChange={(event) => onJdTextChange(event.target.value)} placeholder="粘贴岗位职责、技术栈和任职要求..." className="min-h-48 w-full resize-y rounded-lg border border-slate-200 p-3 text-sm leading-6 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100" />
                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                <button type="button" onClick={onAnalyze} disabled={isLoading} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
                  {isLoading ? <LoaderCircle className="animate-spin" size={18} /> : <FileText size={18} />}
                  {isLoading ? "正在生成匹配报告" : "开始分析"}
                </button>
              </div>
            )}

            {report && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-900">分析结论</h3>
                  <p className="mt-3 leading-7 text-slate-600">{report.summary}</p>
                </div>
                <div className="grid gap-5 xl:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="px-2 text-base font-bold text-slate-900">能力维度</h3><ReactECharts option={radarOption} style={{ height: 300 }} /></div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="px-2 text-base font-bold text-slate-900">技能匹配度</h3><ReactECharts option={gapOption} style={{ height: 300 }} /></div>
                </div>
                <div className="grid gap-5 xl:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-bold text-slate-900">技能缺口</h3><div className="mt-4 flex flex-wrap gap-2">{report.missingSkills.map((skill) => <span key={skill} className="rounded-full bg-amber-50 px-3 py-1.5 text-sm text-amber-800">{skill}</span>)}</div></div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-bold text-slate-900">行动建议</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">{report.actionPlan.map((item) => <li key={item}>{item}</li>)}</ol></div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-bold text-slate-900">可能面试问题</h3><div className="mt-4 space-y-3">{report.interviewQuestions.map((item) => <article key={item.question} className="rounded-lg bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-slate-800"><span>{item.question}</span><span className="text-xs font-normal text-teal-700">{item.difficulty}</span></div><p className="mt-2 text-sm leading-6 text-slate-500">{item.reason}</p></article>)}</div></div>
              </>
            )}
          </div>

          <aside className="h-fit rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><h3 className="font-bold text-slate-900">历史报告</h3><span className="text-xs text-slate-400">{history.length} 条</span></div>
            {history.length === 0 ? <p className="mt-5 text-sm leading-6 text-slate-500">完成一次分析后，报告会保存到 MongoDB。</p> : <div className="mt-4 space-y-2">{history.map((item) => <div key={item.id} className="group flex items-center gap-2 rounded-lg border border-slate-100 p-3 hover:border-teal-200 hover:bg-teal-50"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectHistory(item.id)}><span className="block truncate text-sm font-semibold text-slate-700">{item.resumeFileName}</span><span className="mt-1 block text-xs text-slate-500">匹配度 {item.matchScore} · {new Date(item.createdAt).toLocaleDateString()}</span></button><button type="button" title="删除历史报告" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => onDeleteHistory(item.id)}><Trash2 size={15} /></button></div>)}</div>}
          </aside>
        </div>
      </div>
    </section>
  );
}
