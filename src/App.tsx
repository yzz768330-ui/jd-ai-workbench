import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  FileText,
  LoaderCircle,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  RefreshCw,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useChatStore } from "./store";
import { MatchReportView } from "./components/MatchReportView";
import { QuizSearchView } from "./components/QuizSearchView";
import type {
  AnalysisHistoryItem,
  MatchReport,
  Message,
  Model,
  ParsedFile,
  Session,
} from "./types";

// 模型名称映射，用于在界面中展示可读名称。
const modelNames: Record<Model, string> = {
  "deepseek-chat": "DeepSeek Chat",
  "deepseek-reasoner": "DeepSeek Reasoner",
};

const maxChatRequestChars = 24000;

/** 发送聊天请求前限制历史消息体积，保留首条消息和最近消息。 */
function selectChatRequestMessages(messages: Message[]) {
  if (messages.length <= 1) return messages;

  const first = messages[0];
  const latest = messages[messages.length - 1];
  const messageSize = (message: Message) => message.content.length + (message.attachmentText?.length ?? 0);
  const selected = [first];
  let usedChars = messageSize(first);

  for (let index = 1; index < messages.length - 1; index += 1) {
    const message = messages[index];
    const size = messageSize(message);
    if (usedChars + size > maxChatRequestChars) continue;
    selected.push(message);
    usedChars += size;
  }

  if (!selected.includes(latest)) selected.push(latest);
  return selected;
}

/**
 * 读取 DeepSeek 的 SSE 流式响应，并将每一段文本追加到当前消息内容中。
 */
async function readStream(
  response: Response,
  append: (chunk: string) => void,
): Promise<void> {
  if (!response.body) throw new Error("服务端未返回流式内容。");

  //获取读取器
  const reader = response.body.getReader();
  //每读到一段字节，先用textDecoder解码成字符串，然后按行分割，处理每一行的JSON数据。
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    //当读取到data:[DONE]时，表示流式响应结束，跳出循环。
    if (done) break;

    //追加到buffer中，最后一行可能还没完整接收完，先存进 buffer，等下一次数据到来再继续拼接
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    //得到的类似 data: {"choices":[{"delta":{"content":"hello"}}]}
    lines.forEach((line) => {
      if (!line.startsWith("data: ")) return;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") return;

      try {
        const data = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string };
          }>;
        };

        //提取增量的内容，通过回调append追加到当前助手消息中。
        // delta.content 是普通聊天内容，delta.reasoning_content 是推理模型的推理内容。
        const delta = data.choices?.[0]?.delta;
        append(delta?.content ?? delta?.reasoning_content ?? "");
      } catch {
        // 忽略不完整的流式事件，等待下一批数据继续拼接。
      }
    });
  }
}

/**
 * 单条消息气泡组件，负责展示内容和常用操作按钮。
 */
function MessageBubble({
  message,
  isStreaming,
  onCopy,
  onEdit,
  onRegenerate,
  onDelete,
}: {
  message: Message;
  isStreaming: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const isUser = message.role === "user";

  return (
    <article
      className={`message ${isUser ? "message-user" : "message-assistant"}`}
    >
      <div className="message-meta">{isUser ? "你" : "JD AI 助手"}</div>
      <div className="message-content">
        {message.fileName && (
          <div className="file-chip">
            <FileText size={15} />
            {message.fileName}
          </div>
        )}
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content || "正在生成回答..."}
          </ReactMarkdown>
        )}
      </div>
      {!isStreaming && (
        <div className="message-actions">
          <button type="button" title="复制消息" onClick={onCopy}>
            <Clipboard size={15} />
          </button>
          {isUser && (
            <button type="button" title="编辑并重新提问" onClick={onEdit}>
              <Pencil size={15} />
            </button>
          )}
          {!isUser && (
            <button type="button" title="重新生成" onClick={onRegenerate}>
              <RefreshCw size={15} />
            </button>
          )}
          <button type="button" title="删除消息" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * JD AI 工作台的主应用界面，负责管理会话、聊天、附件以及匹配报告逻辑。
 */
export default function App() {
  // Zustand store 中的会话状态和动作。这里的useChatStore是一个自定义的hook，用于访问和操作全局的聊天状态。
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const createSession = useChatStore((state) => state.createSession);
  const selectSession = useChatStore((state) => state.selectSession);
  const deleteSession = useChatStore((state) => state.deleteSession);
  const updateModel = useChatStore((state) => state.updateModel);
  const addMessage = useChatStore((state) => state.addMessage);
  const replaceMessage = useChatStore((state) => state.replaceMessage);
  const removeMessage = useChatStore((state) => state.removeMessage);
  const removeMessagesAfter = useChatStore(
    (state) => state.removeMessagesAfter,
  );
  const analysisReport = useChatStore((state) => state.analysisReport);
  const analysisId = useChatStore((state) => state.analysisId);
  const analysisHistory = useChatStore((state) => state.analysisHistory);
  const setAnalysis = useChatStore((state) => state.setAnalysis);
  const setAnalysisHistory = useChatStore((state) => state.setAnalysisHistory);
  const clearAnalysis = useChatStore((state) => state.clearAnalysis);

  // 聊天输入与附件相关状态。
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<ParsedFile | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [error, setError] = useState("");

  // 侧边栏和视图切换状态。
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<"chat" | "match" | "quiz">("chat");

  // 简历和岗位匹配数据状态。
  const [resumeFileName, setResumeFileName] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [matchJdFileName, setMatchJdFileName] = useState("");
  const [matchJdText, setMatchJdText] = useState("");
  const [isMatchLoading, setIsMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState("");

  // 生成稳定的客户端标识，用于区分不同浏览器会话的历史分析记录。
  const [clientId] = useState(() => {
    const storageKey = "jd-ai-client-id";
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(storageKey, created);
    return created;
  });

  // 绑定文件输入和消息容器，便于在交互时触发点击和滚动。
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  // 当前激活会话对象，确保在没有匹配时回退到第一条会话。
  const activeSession = useMemo(
    () =>
      sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions],
  );

  // 让流式返回的最新消息始终保持可见，增强对话体验。
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeSession?.messages, isStreaming]);

  // 进入匹配报告页时，读取当前浏览器保存的历史分析摘要。
  useEffect(() => {
    if (activeView !== "match") return;

    void fetch(`/api/analyses?clientId=${encodeURIComponent(clientId)}`)
      .then(async (response) => {
        const data = (await response.json()) as
          | { message?: string }
          | AnalysisHistoryItem[];
        if (!response.ok)
          throw new Error(
            (data as { message?: string }).message ?? "历史报告读取失败。",
          );
        setAnalysisHistory(data as AnalysisHistoryItem[]);
      })
      .catch(() => setAnalysisHistory([]));
  }, [activeView, clientId, setAnalysisHistory]);

  /**
   * 调用后端解析接口，将上传的文件内容转换成统一的结构化文本。
   */
  async function parseFile(file: File): Promise<ParsedFile> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/files/parse", {
      method: "POST",
      body: formData,
    });
    const data = (await response.json()) as ParsedFile & { message?: string };
    if (!response.ok) throw new Error(data.message ?? "文件解析失败。");
    return { fileName: data.fileName, text: data.text };
  }

  /**
   * 解析当前选中的附件，并将其作为聊天上下文挂载到消息中。
   */
  async function handleFileSelection(file: File) {
    setError("");
    setIsParsingFile(true);
    try {
      setAttachment(await parseFile(file));
    } catch (fileError) {
      setError(
        fileError instanceof Error ? fileError.message : "文件解析失败。",
      );
    } finally {
      setIsParsingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /**
   * 解析简历文件，并将文本填充到匹配报告的简历输入区。
   */
  async function handleResumeFile(file: File) {
    setMatchError("");
    try {
      const parsed = await parseFile(file);
      setResumeFileName(parsed.fileName);
      setResumeText(parsed.text);
    } catch (fileError) {
      setMatchError(
        fileError instanceof Error ? fileError.message : "简历解析失败。",
      );
    }
  }

  /**
   * 解析 JD 文件，并填充到岗位文本编辑区域。
   */
  async function handleMatchJdFile(file: File) {
    setMatchError("");
    try {
      const parsed = await parseFile(file);
      setMatchJdFileName(parsed.fileName);
      setMatchJdText(parsed.text);
    } catch (fileError) {
      setMatchError(
        fileError instanceof Error ? fileError.message : "JD 解析失败。",
      );
    }
  }

  /**
   * 调用结构化分析接口，将简历和 JD 的匹配结果保存到 Zustand 和数据库。
   */
  async function handleMatchAnalyze() {
    if (!resumeText.trim() || !matchJdText.trim()) {
      setMatchError("请先上传简历，并输入或上传目标 JD。");
      return;
    }

    setMatchError("");
    setIsMatchLoading(true);
    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          resumeFileName: resumeFileName || "简历文本",
          resumeText,
          jdFileName: matchJdFileName || undefined,
          jdText: matchJdText,
        }),
      });
      const data = (await response.json()) as {
        id?: string;
        report?: MatchReport;
        message?: string;
      };
      if (!response.ok || !data.id || !data.report)
        throw new Error(data.message ?? "匹配分析失败。");
      setAnalysis(data.id, data.report);
      await loadAnalysisHistory();
    } catch (analysisError) {
      setMatchError(
        analysisError instanceof Error
          ? analysisError.message
          : "匹配分析失败。",
      );
    } finally {
      setIsMatchLoading(false);
    }
  }

  /**
   * 从后端刷新当前客户端的历史分析摘要列表。
   */
  async function loadAnalysisHistory() {
    const response = await fetch(
      `/api/analyses?clientId=${encodeURIComponent(clientId)}`,
    );
    const data = (await response.json()) as
      | { message?: string }
      | AnalysisHistoryItem[];
    if (!response.ok)
      throw new Error(
        (data as { message?: string }).message ?? "历史报告读取失败。",
      );
    setAnalysisHistory(data as AnalysisHistoryItem[]);
  }

  /**
   * 读取历史报告的完整内容，并展示到当前报告页中。
   */
  async function handleSelectHistory(id: string) {
    setMatchError("");
    try {
      const response = await fetch(
        `/api/analyses/${id}?clientId=${encodeURIComponent(clientId)}`,
      );
      const data = (await response.json()) as {
        id?: string;
        report?: MatchReport;
        message?: string;
      };
      if (!response.ok || !data.id || !data.report)
        throw new Error(data.message ?? "报告读取失败。");
      setAnalysis(data.id, data.report);
    } catch (historyError) {
      setMatchError(
        historyError instanceof Error ? historyError.message : "报告读取失败。",
      );
    }
  }

  /**
   * 删除历史报告，并同步清理当前展示中的结果。
   */
  async function handleDeleteHistory(id: string) {
    const response = await fetch(
      `/api/analyses/${id}?clientId=${encodeURIComponent(clientId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setMatchError("报告删除失败。");
      return;
    }
    setAnalysisHistory(analysisHistory.filter((item) => item.id !== id));
    if (analysisId === id) clearAnalysis();
  }

  /**
   * 向后端发送已准备好的消息，并创建一个空白的助手消息来接收流式回复。
   */
  async function streamReply(
    session: Session,
    messages: Message[],
    assistantMessageId: string,
  ) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: session.model,
          messages: selectChatRequestMessages(messages),
        }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { message?: string };
        throw new Error(data.message ?? "AI 请求失败。");
      }

      //readStream 读取流式响应，并在每次接收到新内容时调用 replaceMessage 更新当前助手消息的内容。
      await readStream(response, (chunk) => {
        // 每次拿到新片段流式文本chunk就去根性对应的助手消息的content，
        // 不是直接去修改DOM，而是通过Zustand的replaceMessage去更新全局状态，React组件会根据store更新重新渲染。
        const current = useChatStore
          .getState()
          .sessions.find((item) => item.id === session.id);
        const currentMessage = current?.messages.find(
          (item) => item.id === assistantMessageId,
        );

        replaceMessage(
          session.id,
          assistantMessageId,
          `${currentMessage?.content ?? ""}${chunk}`,
        );
      });
    } catch (chatError) {
      const message =
        chatError instanceof Error ? chatError.message : "AI 请求失败。";
      replaceMessage(session.id, assistantMessageId, `请求失败：${message}`);
    } finally {
      setIsStreaming(false);
    }
  }

  /**
   * 发送消息，分成两种情况：新消息和编辑消息。
   * 如果是新消息，则直接添加到当前会话中。
   * 如果是编辑消息，则替换原有内容，并删除其后的所有消息。
   */
  async function handleSend() {
    //1. 判断是否可以发送：
    // 没有当前会话，正在流式回复中的，输入框和附件为空的情况下都不允许发送消息。
    if (!activeSession || isStreaming || (!input.trim() && !attachment)) return;

    setError("");
    setIsStreaming(true);

    //2. 组装当前用户的消息
    // 如果输入框为空但有附件，则将附件内容作为消息发送。
    // 如果输入框有内容，则将输入框内容作为消息发送。
    const userContent = input.trim() || "请分析这份 JD，并给出秋招准备建议。";

    // 创建用户消息的对象，包含唯一ID、角色、内容、附件文件名和附件文本。
    const userMessage: Message = {
      id: editingMessageId ?? crypto.randomUUID(),
      role: "user",
      content: userContent,
      fileName: attachment?.fileName,
      attachmentText: attachment?.text,
    };
    let requestMessages: Message[];

    // 情况一、编辑旧消息重新发送
    //     / 找到被找到被编辑的那条消息的位置
    // 把它替换成新内容
    // 删除它后面的所有消息
    // 重新构造一份“从开头到当前编辑消息”的上下文列表
    // 这样做的目的：

    // 让模型在重试时，不再带着旧的后续错误回答
    // 保持编辑后的最新上下文
    if (editingMessageId) {
      const editIndex = activeSession.messages.findIndex(
        (message) => message.id === editingMessageId,
      );
      replaceMessage(activeSession.id, editingMessageId, userContent);
      removeMessagesAfter(activeSession.id, editingMessageId);
      //把这部分裁剪出来然后替换被编辑的那条消息
      requestMessages = activeSession.messages
        .slice(0, editIndex + 1)
        .map((message) =>
          message.id === editingMessageId ? userMessage : message,
        );
    } else {
      //新消息
      addMessage(activeSession.id, userMessage);
      requestMessages = [...activeSession.messages, userMessage];
    }

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };
    addMessage(activeSession.id, assistantMessage);
    setInput("");
    setAttachment(null);
    setEditingMessageId(null);
    await streamReply(activeSession, requestMessages, assistantMessage.id);
  }

  /**
   * 把一条历史消息加载到输入框中，准备重新编辑与追问。
   */
  function handleEdit(message: Message) {
    setInput(message.content);
    setAttachment(
      message.attachmentText
        ? { fileName: message.fileName ?? "附件", text: message.attachmentText }
        : null,
    );
    setEditingMessageId(message.id);
  }

  /**
   * 删除当前助手回答并在此前上下文基础上重新生成回复。
   */
  async function handleRegenerate(message: Message) {
    if (!activeSession || isStreaming) return;

    const index = activeSession.messages.findIndex(
      (item) => item.id === message.id,
    );
    const requestMessages = activeSession.messages.slice(0, index);
    removeMessage(activeSession.id, message.id);
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };
    addMessage(activeSession.id, assistantMessage);
    setIsStreaming(true);
    await streamReply(activeSession, requestMessages, assistantMessage.id);
  }

  /**
   * 将消息内容复制到浏览器剪贴板。
   */
  async function handleCopy(content: string) {
    await navigator.clipboard.writeText(content);
  }

  if (!activeSession) return null;

  return (
    <main className="app-shell">
      <aside
        className={`sidebar ${isSidebarOpen ? "sidebar-open" : "sidebar-closed"}`}
      >
        <div className="brand">
          <span className="brand-mark">
            <Bot size={20} />
          </span>
          <span>JD AI 工作台</span>
        </div>
        <button
          type="button"
          className="new-chat"
          onClick={() => {
            setActiveView("chat");
            createSession();
          }}
        >
          <MessageSquarePlus size={17} /> 新建分析
        </button>
        <div className="mb-4 grid grid-cols-3 gap-1 rounded-md bg-slate-700 p-1">
          <button
            type="button"
            className={`rounded px-2 py-2 text-xs ${activeView === "chat" ? "bg-white text-slate-800" : "text-slate-200"}`}
            onClick={() => setActiveView("chat")}
          >
            JD 对话
          </button>
          <button
            type="button"
            className={`rounded px-2 py-2 text-xs ${activeView === "match" ? "bg-white text-slate-800" : "text-slate-200"}`}
            onClick={() => setActiveView("match")}
          >
            匹配报告
          </button>
          <button
            type="button"
            className={`rounded px-2 py-2 text-xs ${activeView === "quiz" ? "bg-white text-slate-800" : "text-slate-200"}`}
            onClick={() => setActiveView("quiz")}
          >
            八股检索
          </button>
        </div>
        <nav className="session-list" aria-label="历史会话">
          <p className="section-label">历史会话</p>
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${session.id === activeSession.id ? "session-active" : ""}`}
            >
              <button
                type="button"
                className="session-select"
                onClick={() => selectSession(session.id)}
              >
                {session.title}
              </button>
              <button
                type="button"
                className="session-delete"
                title="删除会话"
                onClick={() => deleteSession(session.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </nav>
        <p className="sidebar-note">聊天保存在浏览器，报告保存在 MongoDB</p>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <button
            type="button"
            className="icon-button"
            title={isSidebarOpen ? "收起侧栏" : "展开侧栏"}
            onClick={() => setIsSidebarOpen((open) => !open)}
          >
            {isSidebarOpen ? (
              <ChevronLeft size={19} />
            ) : (
              <ChevronRight size={19} />
            )}
          </button>
          <div>
            <h1>
              {activeView === "chat"
                ? activeSession.title
                : activeView === "match"
                  ? "简历-JD 匹配报告"
                  : "八股题检索"}
            </h1>
            <p>
              {activeView === "chat"
                ? "JD 解析与秋招准备"
                : activeView === "match"
                  ? "结构化分析与技能缺口识别"
                  : "题库检索与 AI 八股解释"}
            </p>
          </div>
          {activeView === "chat" && (
            <label className="model-picker">
              <span>模型</span>
              <select
                value={activeSession.model}
                onChange={(event) =>
                  updateModel(activeSession.id, event.target.value as Model)
                }
                disabled={isStreaming}
              >
                {(Object.keys(modelNames) as Model[]).map((model) => (
                  <option key={model} value={model}>
                    {modelNames[model]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        <section className="chat-panel">
          {activeView === "quiz" ? (
            <QuizSearchView clientId={clientId} />
          ) : activeView === "match" ? (
            <MatchReportView
              report={analysisReport}
              history={analysisHistory}
              resumeFileName={resumeFileName}
              jdFileName={matchJdFileName}
              jdText={matchJdText}
              isLoading={isMatchLoading}
              error={matchError}
              onResumeFile={(file) => void handleResumeFile(file)}
              onJdFile={(file) => void handleMatchJdFile(file)}
              onJdTextChange={setMatchJdText}
              onAnalyze={() => void handleMatchAnalyze()}
              onReset={() => {
                clearAnalysis();
                setMatchError("");
              }}
              onSelectHistory={(id) => void handleSelectHistory(id)}
              onDeleteHistory={(id) => void handleDeleteHistory(id)}
            />
          ) : activeSession.messages.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Bot size={28} />
              </span>
              <h2>开始一份 JD 分析</h2>
              <p>
                上传岗位描述，或直接粘贴 JD，获取职责、技术栈和面试准备建议。
              </p>
              <div className="prompt-grid">
                <button
                  type="button"
                  onClick={() =>
                    setInput(
                      "请分析这份前端 + AI 应用实习 JD，并给我一个半个月可完成的项目方案。",
                    )
                  }
                >
                  分析岗位要求
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setInput(
                      "根据这份 JD，列出我需要准备的项目亮点和面试问题。",
                    )
                  }
                >
                  生成面试准备
                </button>
              </div>
            </div>
          ) : (
            <div className="message-list">
              {activeSession.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isStreaming={isStreaming}
                  onCopy={() => void handleCopy(message.content)}
                  onEdit={() => handleEdit(message)}
                  onRegenerate={() => void handleRegenerate(message)}
                  onDelete={() => removeMessage(activeSession.id, message.id)}
                />
              ))}
              <div ref={messageEndRef} />
            </div>
          )}
        </section>

        {activeView === "chat" && (
          <footer className="composer-wrap">
            {error && <p className="error-message">{error}</p>}
            {attachment && (
              <div className="composer-file">
                <FileText size={16} />
                <span>{attachment.fileName}</span>
                <button
                  type="button"
                  title="移除附件"
                  onClick={() => setAttachment(null)}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="composer">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept=".txt,.md,.csv,.json,.pdf,.docx"
                onChange={(event) =>
                  event.target.files?.[0] &&
                  void handleFileSelection(event.target.files[0])
                }
              />
              <button
                type="button"
                className="icon-button"
                title="上传 JD 文件"
                disabled={isStreaming || isParsingFile}
                onClick={() => fileInputRef.current?.click()}
              >
                {isParsingFile ? (
                  <LoaderCircle className="spin" size={19} />
                ) : (
                  <Paperclip size={19} />
                )}
              </button>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={
                  editingMessageId
                    ? "编辑后按 Enter 重新提问"
                    : "粘贴 JD 或输入你的问题..."
                }
                rows={2}
                disabled={isStreaming}
              />
              <button
                type="button"
                className="send-button"
                title="发送消息"
                onClick={() => void handleSend()}
                disabled={
                  isStreaming || isParsingFile || (!input.trim() && !attachment)
                }
              >
                {isStreaming ? (
                  <LoaderCircle className="spin" size={19} />
                ) : (
                  <SendHorizontal size={19} />
                )}
              </button>
            </div>
            <p className="composer-hint">
              Enter 发送，Shift + Enter 换行。附件最多提取 16000 个字符，扫描版 PDF 会自动 OCR。
            </p>
          </footer>
        )}
      </section>
    </main>
  );
}
