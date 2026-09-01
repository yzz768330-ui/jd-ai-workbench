import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bookmark, Bot, CheckCircle2, Database, History, LoaderCircle, RotateCcw, Search, SendHorizontal } from "lucide-react";
import type { QuizDirection, QuizHistoryItem, QuizMessage, QuizQuestion, QuizSearchResponse } from "../types";

type QuizConversationMessage = QuizMessage & { records?: QuizQuestion[] };

type QuizSearchViewProps = {
  clientId: string;
};

const directions: QuizDirection[] = ["前端", "Node 环境", "AI 应用"];

/** 八股题检索页，组合筛选、题库召回、AI 解释与历史记录。 */
export function QuizSearchView({ clientId }: QuizSearchViewProps) {
  const [direction, setDirection] = useState<QuizDirection>("前端");
  const [technology, setTechnology] = useState("");
  const [company, setCompany] = useState("");
  const [scenario, setScenario] = useState("");
  const [messages, setMessages] = useState<QuizConversationMessage[]>([]);
  const [history, setHistory] = useState<QuizHistoryItem[]>([]);
  const [remaining, setRemaining] = useState(10);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const usedCount = useMemo(() => 10 - remaining, [remaining]);

  /** 读取服务端的每日额度，避免只依赖浏览器本地状态。 */
  async function loadQuota() {
    const response = await fetch(`/api/quiz/quota?clientId=${encodeURIComponent(clientId)}`);
    const data = (await response.json()) as { remaining?: number; message?: string };
    if (!response.ok) throw new Error(data.message ?? "免费额度读取失败。");
    setRemaining(data.remaining ?? 10);
  }

  /** 刷新当前浏览器的自动检索记录列表。 */
  async function loadHistory() {
    const response = await fetch(`/api/quiz/records?clientId=${encodeURIComponent(clientId)}`);
    const data = (await response.json()) as QuizHistoryItem[] | { message?: string };
    if (!response.ok) throw new Error((data as { message?: string }).message ?? "检索记录读取失败。");
    setHistory(data as QuizHistoryItem[]);
  }

  useEffect(() => {
    void Promise.all([loadQuota(), loadHistory()]).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "八股检索数据读取失败。");
    });
  }, [clientId]);

  /** 发送当前检索条件，拿到题库命中结果和基于题目的 AI 解释。 */
  async function handleSearch() {
    if (!technology.trim() || isSearching) return;

    setError("");
    setNotice("");
    setIsSearching(true);
    const createdAt = new Date().toISOString();
    const userMessage: QuizConversationMessage = { role: "user", content: technology.trim(), createdAt };
    setMessages((current) => [...current, userMessage]);

    try {
      const response = await fetch("/api/quiz/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, direction, query: technology.trim(), company, scenario }),
      });
      const data = (await response.json()) as QuizSearchResponse & { message?: string };
      if (!response.ok) throw new Error(data.message ?? "八股检索失败。");
      setMessages((current) => [...current, { role: "assistant", content: data.answer, records: data.records, createdAt: new Date().toISOString() }]);
      setRemaining(data.remaining);
      setTechnology("");
      await loadHistory();
    } catch (searchError) {
      setMessages((current) => current.filter((message) => message !== userMessage));
      setError(searchError instanceof Error ? searchError.message : "八股检索失败。");
    } finally {
      setIsSearching(false);
    }
  }

  /** 清空当前会话的消息和提示，不删除已落库的检索记录。 */
  function handleReset() {
    setMessages([]);
    setTechnology("");
    setError("");
    setNotice("");
  }

  /** 将当前多轮对话手动保存为一条 MongoDB 会话记录。 */
  async function handleSaveConversation() {
    if (messages.length === 0 || isSaving) return;

    setError("");
    setNotice("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/quiz/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          direction,
          messages: messages.map(({ role, content, createdAt }) => ({ role, content, createdAt })),
        }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "对话保存失败。");
      setNotice("对话已保存到 MongoDB。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "对话保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  /** 读取历史检索详情，并恢复到当前的对话展示区。 */
  async function handleSelectHistory(id: string) {
    setError("");
    try {
      const response = await fetch(`/api/quiz/records/${id}?clientId=${encodeURIComponent(clientId)}`);
      const data = (await response.json()) as { query: string; direction: QuizDirection; company?: string; scenario?: string; records: QuizQuestion[]; answer: string; createdAt: string; message?: string };
      if (!response.ok) throw new Error(data.message ?? "检索记录读取失败。");
      setDirection(data.direction);
      setCompany(data.company ?? "");
      setScenario(data.scenario ?? "");
      setMessages([
        { role: "user", content: data.query, createdAt: data.createdAt },
        { role: "assistant", content: data.answer, records: data.records, createdAt: data.createdAt },
      ]);
      setShowHistory(false);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "检索记录读取失败。");
    }
  }

  return (
    <section className="quiz-layout">
      <aside className="quiz-info-panel">
        <div className="quiz-quota">
          <Database size={18} />
          <p>免费账号每天检索 10 次</p>
          <strong>今日已用 {usedCount} 次，剩余 {remaining} 次</strong>
        </div>
        <div className="quiz-rule-block">
          <h2>检索规则</h2>
          <ol>
            <li>先按岗位方向、公司和场景筛选审核通过的题库。</li>
            <li>向量召回语义相近题目，关键词命中用于提升排序。</li>
            <li>AI 仅基于命中题目和官方来源生成解释。</li>
            <li>题库未命中时不会消耗当日免费次数。</li>
          </ol>
        </div>
        <div className="quiz-rule-block quiz-module-block">
          <h2>模块说明</h2>
          <p>这不是普通聊天。每次问题都会先进入题库检索，再由 AI 组织标准回答、追问方向和易错点。</p>
          <div className="quiz-module-tags">
            <span>题库检索</span><span>混合 RAG</span><span>官方来源</span><span>审核题目</span>
          </div>
        </div>
      </aside>

      <section className="quiz-main-panel">
        <header className="quiz-header">
          <div>
            <h2>八股题检索</h2>
            <p>输入技术方向或目标公司，AI 从题库中检索高频八股面试题</p>
          </div>
          <label className="quiz-direction-picker">
            <span>岗位方向</span>
            <select value={direction} onChange={(event) => setDirection(event.target.value as QuizDirection)} disabled={isSearching}>
              {directions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </header>

        <div className="quiz-filter-row">
          <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="目标公司（可选，如字节跳动）" disabled={isSearching} />
          <input value={scenario} onChange={(event) => setScenario(event.target.value)} placeholder="面试场景（可选，如浏览器原理）" disabled={isSearching} />
        </div>

        <div className="quiz-toolbar">
          <button type="button" className="quiz-primary-button" onClick={() => void handleSaveConversation()} disabled={messages.length === 0 || isSaving}>
            {isSaving ? <LoaderCircle className="spin" size={17} /> : <Bookmark size={17} />} 保存对话
          </button>
          <button type="button" className="quiz-secondary-button" onClick={handleReset} disabled={isSearching}><RotateCcw size={17} /> 重置对话</button>
          <button type="button" className="quiz-secondary-button" onClick={() => setShowHistory((value) => !value)}><History size={17} /> 检索记录</button>
        </div>

        {error && <p className="error-message quiz-feedback">{error}</p>}
        {notice && <p className="quiz-notice"><CheckCircle2 size={16} /> {notice}</p>}

        <div className="quiz-conversation">
          {messages.length === 0 ? (
            <div className="quiz-welcome">
              <span className="quiz-bot-avatar"><Bot size={26} /></span>
              <div>
                <h3>你好，我是{direction}八股检索助手</h3>
                <p>可以结合技术方向、目标公司和面试场景检索高频题目。</p>
                <ul>
                  <li>字节常考的 JavaScript 题有哪些？</li>
                  <li>React 高并发场景下的状态更新问题</li>
                  <li>RAG 检索增强生成的常见面试题</li>
                </ul>
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <article key={`${message.createdAt}-${index}`} className={`quiz-message ${message.role === "user" ? "quiz-message-user" : "quiz-message-assistant"}`}>
                <span className="quiz-message-avatar">{message.role === "user" ? "你" : <Bot size={18} />}</span>
                <div className="quiz-message-content">
                  {message.role === "user" ? <p>{message.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}
                  {message.records && message.records.length > 0 && (
                    <div className="quiz-result-list">
                      {message.records.map((record) => (
                        <article key={record.id} className="quiz-result-card">
                          <div className="quiz-result-title"><h4>{record.question}</h4><span>{record.difficulty}</span></div>
                          <div className="quiz-result-tags">{record.tags.map((tag) => <span key={tag}>{tag}</span>)}<em>{record.matchType}命中</em></div>
                          <a href={record.source.url} target="_blank" rel="noreferrer">参考来源：{record.source.title}</a>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
          {isSearching && <div className="quiz-loading"><LoaderCircle className="spin" size={20} /> 正在检索题库并生成解释...</div>}
        </div>

        <footer className="quiz-composer">
          <div className="quiz-composer-input">
            <Search size={19} />
            <textarea value={technology} onChange={(event) => setTechnology(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void handleSearch(); } }} placeholder="输入想查找的技术方向，如“LangChain 常考八股题”" rows={2} disabled={isSearching || remaining <= 0} />
            <button type="button" title="开始检索" onClick={() => void handleSearch()} disabled={isSearching || !technology.trim() || remaining <= 0}>{isSearching ? <LoaderCircle className="spin" size={19} /> : <SendHorizontal size={19} />}</button>
          </div>
          <p>Enter 检索，Shift + Enter 换行。仅在检索成功并生成解释后消耗额度。</p>
        </footer>
      </section>

      {showHistory && (
        <aside className="quiz-history-panel">
          <div className="quiz-history-title"><h2>检索记录</h2><button type="button" onClick={() => setShowHistory(false)}>关闭</button></div>
          {history.length === 0 ? <p>还没有检索记录。</p> : history.map((item) => <button type="button" className="quiz-history-item" key={item.id} onClick={() => void handleSelectHistory(item.id)}><strong>{item.query}</strong><span>{item.direction} · {item.resultCount} 题 · {new Date(item.createdAt).toLocaleDateString()}</span></button>)}
        </aside>
      )}
    </section>
  );
}
