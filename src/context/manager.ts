/**
 * OpenColaOS — 上下文管理器
 *
 * 三级上下文架构：
 *   Active Context (working memory) → Episodic Buffer (checkpoints) → Long-term (vector retrieval)
 */

import { nanoid } from "nanoid";
import {
  ContextCheckpoint,
  ContextQuery,
  MemoryType,
  MemoryEntry,
} from "../types/index.ts";
import { MemoryStore, simpleEmbed } from "../memory/store.ts";

interface WorkingMemoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

const MAX_WORKING_TOKENS = 100_000;   // 约 75K 英文词
const CHECKPOINT_INTERVAL = 20;        // 每 20 条消息生成一个 checkpoint
const MAX_CHECKPOINTS = 10;            // episodic buffer 中保留的 checkpoint 数

export class ContextManager {
  private workingMemory: WorkingMemoryMessage[] = [];
  private checkpointCount: number = 0;

  constructor(private store: MemoryStore) {}

  /** 添加一条消息到工作记忆 */
  addMessage(role: WorkingMemoryMessage["role"], content: string): void {
    this.workingMemory.push({ role, content, timestamp: Date.now() });

    // 检查是否触发 checkpoint
    if (this.workingMemory.length % CHECKPOINT_INTERVAL === 0) {
      this.autoCheckpoint();
    }

    // 检查是否超过 token 限制（粗略估算）
    if (this.estimateTokens() > MAX_WORKING_TOKENS) {
      this.evictOldest();
    }
  }

  /** 获取当前完整上下文 */
  getContext(): ContextQuery {
    const raw = this.getWorkingMemoryText();
    const checkpoints = this.store.getRecentCheckpoints(MAX_CHECKPOINTS);

    return {
      query: raw.slice(-500),  // 最近的文本，用于检索
      activeContext: this.buildActiveContext(),
      checkpoints,
      retrievedMemories: [],
      relevantDreams: this.store.getDreamJournals(7),
    };
  }

  /** 检索相关记忆并注入上下文 */
  async enrichWithMemory(query: string): Promise<MemoryEntry[]> {
    const queryVec = simpleEmbed(query);
    const results = this.store.searchByVector(queryVec, 5);
    const memories = results.map(r => r.memory);

    // 也获取高优先级的长程记忆
    const importantMems = this.store.searchMemories({
      minImportance: 8,
      limit: 3,
      type: MemoryType.Episodic,
    });

    const all = [...memories, ...importantMems];
    // 去重
    const seen = new Set<string>();
    const unique = all.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    return unique;
  }

  /** 构建发送给 LLM 的完整 prompt */
  buildActiveContext(): string {
    const recentMessages = this.workingMemory.slice(-10);
    const checkpoints = this.store.getRecentCheckpoints(MAX_CHECKPOINTS);
    const profile = this.store.getUserProfile();
    const identity = this.store.getCoreIdentity();

    let ctx = "";

    // 1. Core Identity
    ctx += `[SYSTEM] 我是 ${identity.name}。\n`;
    ctx += `我的使命：${identity.mission}\n`;
    ctx += `我的价值观：${identity.coreValues.join("、")}\n`;
    ctx += `我与用户的关系：${identity.relationshipWithUser}\n\n`;

    // 2. User Profile
    if (profile.name) ctx += `用户姓名：${profile.name}\n`;
    if (profile.facts.length > 0) {
      ctx += `关于用户的信息：\n${profile.facts.map(f => `- ${f}`).join("\n")}\n`;
    }
    ctx += `我们关系的阶段：${profile.relationshipStage}\n\n`;

    // 3. Recent checkpoints (episodic buffer)
    if (checkpoints.length > 0) {
      ctx += `[近期上下文摘要]\n`;
      for (const cp of checkpoints.slice(0, 3)) {
        ctx += `- ${cp.summary}\n`;
      }
      ctx += "\n";
    }

    // 4. 今日梦境摘要（如果有）
    const today = new Date().toISOString().slice(0, 10);
    const todayDream = this.store.getDreamByDate(today);
    if (todayDream && todayDream.morningBriefing) {
      ctx += `[今日梦境] ${todayDream.morningBriefing}\n\n`;
    }

    // 5. Working memory (最近消息)
    ctx += `[当前对话]\n`;
    for (const msg of recentMessages) {
      const prefix = msg.role === "user" ? "用户" : msg.role === "assistant" ? "我" : "系统";
      ctx += `${prefix}: ${msg.content}\n`;
    }

    return ctx;
  }

  /** 获取当前工作记忆的纯文本（用于 checkpoint 生成） */
  getWorkingMemoryText(): string {
    return this.workingMemory.map(m =>
      `${m.role === "user" ? "用户" : m.role === "assistant" ? "Cola" : "系统"}: ${m.content}`
    ).join("\n");
  }

  /** 自动生成 checkpoint */
  private autoCheckpoint(): void {
    const now = Date.now();
    const messages = this.workingMemory;
    const recentBatch = messages.slice(-CHECKPOINT_INTERVAL);

    // 生成摘要（实际应该调 LLM，这里先用启发式）
    const summary = this.generateCheckpointSummary(recentBatch);
    const topics = this.extractTopics(recentBatch);

    const cp = this.store.saveCheckpoint({
      summary,
      topicTags: topics,
      startTime: recentBatch[0]?.timestamp || now,
      endTime: now,
      messageCount: recentBatch.length,
      tokenEstimate: recentBatch.reduce((s, m) => s + m.content.length, 0),
      keyPoints: [],
      emotionalTone: undefined,
    });

    // 同时存储为 episodic memory
    this.store.storeMemory({
      type: MemoryType.Episodic,
      content: summary,
      summary,
      tags: topics,
      importance: 6,
      embedding: simpleEmbed(summary),
    });

    this.checkpointCount++;
  }

  /** 当工作记忆超限时，淘汰最早的非关键消息 */
  private evictOldest(): void {
    // 保留最近的 60 条，其余移除（已通过 checkpoint 保存）
    if (this.workingMemory.length > 100) {
      this.workingMemory = this.workingMemory.slice(-60);
    }
  }

  /** 估算 token 数（粗略） */
  private estimateTokens(): number {
    return this.workingMemory.reduce((s, m) => s + m.content.length, 0) * 1.3;
  }

  /** 启发式 checkpoint 摘要生成（生产环境应调 LLM） */
  private generateCheckpointSummary(messages: WorkingMemoryMessage[]): string {
    const topics = this.extractTopics(messages);
    const userMsgs = messages.filter(m => m.role === "user");
    const assistantMsgs = messages.filter(m => m.role === "assistant");

    return `讨论了 ${topics.join("、")}。用户说了 ${userMsgs.length} 句话，Cola 回应了 ${assistantMsgs.length} 次。`;
  }

  /** 简单话题提取 */
  private extractTopics(messages: WorkingMemoryMessage[]): string[] {
    const text = messages.map(m => m.content).join(" ");
    // 提取名词性关键词（简化版）
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w);
  }

  /** 清空工作记忆（切换任务时） */
  clearWorkingMemory(): void {
    this.workingMemory = [];
  }

  /** 注入 checkpoint 重建上下文（恢复任务时） */
  restoreFromCheckpoint(checkpointId: string): void {
    const cps = this.store.getRecentCheckpoints(100);
    const cp = cps.find(c => c.id === checkpointId);
    if (cp) {
      this.workingMemory.push({
        role: "system",
        content: `[恢复上下文] ${cp.summary}`,
        timestamp: cp.endTime,
      });
    }
  }
}