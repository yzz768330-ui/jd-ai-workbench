import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AnalysisHistoryItem, MatchReport, Message, Model, Session } from "./types";

/** Creates a blank session used when the user first opens the workbench. */
//这是什么意思
//
function createBlankSession(): Session {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "新建 JD 分析",
    model: "deepseek-chat",
    messages: [],
    updatedAt: now,
  };
}

type ChatState = {
  sessions: Session[];
  activeSessionId: string;
  analysisId: string | null;
  analysisReport: MatchReport | null;
  analysisHistory: AnalysisHistoryItem[];
  createSession: () => void;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  updateModel: (id: string, model: Model) => void;
  addMessage: (id: string, message: Message) => void;
  replaceMessage: (sessionId: string, messageId: string, content: string) => void;
  removeMessage: (sessionId: string, messageId: string) => void;
  removeMessagesAfter: (sessionId: string, messageId: string) => void;
  setAnalysis: (id: string, report: MatchReport) => void;
  setAnalysisHistory: (items: AnalysisHistoryItem[]) => void;
  clearAnalysis: () => void;
};

const firstSession = createBlankSession();

/** Stores local-only chat sessions and persists them in the browser. */
export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      sessions: [firstSession],
      activeSessionId: firstSession.id,
      analysisId: null,
      analysisReport: null,
      analysisHistory: [],
      createSession: () => {
        // Places a new blank session at the top and makes it active.
        const session = createBlankSession();
        set((state) => ({ sessions: [session, ...state.sessions], activeSessionId: session.id }));
      },
      // Switches the visible conversation without modifying its messages.
      selectSession: (id) => set({ activeSessionId: id }),
      deleteSession: (id) => {
        // Keeps one blank session available when the user deletes the final one.
        set((state) => {
          const sessions = state.sessions.filter((session) => session.id !== id);
          const remaining = sessions.length > 0 ? sessions : [createBlankSession()];
          return { sessions: remaining, activeSessionId: remaining[0].id };
        });
      },
      updateModel: (id, model) => {
        // Saves the model choice on its own session for later requests.
        set((state) => ({
          sessions: state.sessions.map((session) => (session.id === id ? { ...session, model, updatedAt: Date.now() } : session)),
        }));
      },
      addMessage: (id, message) => {
        // Uses the first user message as a compact history title.
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== id) return session;
            const title = session.messages.length === 0 ? message.content.slice(0, 18) || "JD 文件分析" : session.title;
            return { ...session, title, messages: [...session.messages, message], updatedAt: Date.now() };
          }),
        }));
      },

        //用于替换指定会话中指定消息的内容，并更新该会话的更新时间。
        //这里的set是Zustand提供的一个函数，用于更新全局状态。
        // 它接收一个函数作为参数，这个函数的参数是当前的状态(state)，
        // 返回一个新的状态对象。
      replaceMessage: (sessionId, messageId, content) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? { ...session, messages: session.messages.map((message) => (message.id === messageId ? { ...message, content } : message)), updatedAt: Date.now() }
              : session,
          ),
        }));
      },
      //这个方法是用于从指定会话中删除消息的
      removeMessage: (sessionId, messageId) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId ? { ...session, messages: session.messages.filter((message) => message.id !== messageId), updatedAt: Date.now() } : session,
          ),
        }));
      },
      //用于删除指定会话中某条消息之后的所有消息。
      removeMessagesAfter: (sessionId, messageId) => {
        set((state) => ({
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) return session;
            const index = session.messages.findIndex((message) => message.id === messageId);
            return index === -1 ? session : { ...session, messages: session.messages.slice(0, index + 1), updatedAt: Date.now() };
          }),
        }));
      },
      setAnalysis: (id, report) => {
        // 把最新报告放进 Zustand，保证报告页和图表使用同一份数据。
        set({ analysisId: id, analysisReport: report });
      },
      setAnalysisHistory: (items) => {
        // 保存服务端返回的报告摘要，供历史列表快速展示。
        set({ analysisHistory: items });
      },
      clearAnalysis: () => {
        // 清空当前报告但保留历史记录，便于用户开始下一次分析。
        set({ analysisId: null, analysisReport: null });
      },
    }),
    { name: "jd-ai-workbench", storage: createJSONStorage(() => localStorage) },
  ),
);
