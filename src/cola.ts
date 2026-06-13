/**
 * OpenColaOS — 核心 Cola 类
 *
 * 整合所有子系统：记忆、身份、上下文、梦境、中断协议
 * 对外提供统一的 API
 */

import { MemoryStore } from "./memory/store.ts";
import { ContextManager } from "./context/manager.ts";
import { IdentitySystem } from "./identity/index.ts";
import { DreamEngine } from "./dream/engine.ts";
import { InterruptProtocol } from "./interrupt/protocol.ts";
import {
  MemoryType,
  MemoryEntry,
  ContextCheckpoint,
  ContextQuery,
  DreamJournal,
  TaskSnapshot,
  CoreIdentity,
  UserProfile,
  RelationshipStage,
} from "./types/index.ts";

export interface ColaOptions {
  dbPath?: string;
  name?: string;
}

export class Cola {
  readonly store: MemoryStore;
  readonly context: ContextManager;
  readonly identity: IdentitySystem;
  readonly dream: DreamEngine;
  readonly interrupt: InterruptProtocol;

  private conversationLog: string[] = [];

  constructor(options: ColaOptions = {}) {
    this.store = new MemoryStore(options.dbPath);

    // 如果指定了名字，初始化身份
    if (options.name) {
      const identity = this.store.getCoreIdentity();
      if (identity.name !== options.name) {
        this.store.evolveIdentity({ name: options.name });
      }
    }

    this.context = new ContextManager(this.store);
    this.identity = new IdentitySystem(this.store);
    this.dream = new DreamEngine(this.store, this.identity);
    this.interrupt = new InterruptProtocol(this.store, this.context);
  }

  // ==================== 对话接口 ====================

  /** 用户说了一句话（主入口） */
  async hear(userMessage: string): Promise<{
    response: string;
    context: ContextQuery;
    shouldRemember?: { should: boolean; category?: string; reason: string };
  }> {
    // 1. 记录对话
    this.conversationLog.push(`用户: ${userMessage}`);
    this.context.addMessage("user", userMessage);

    // 2. 判断是否需要记住
    const rememberCheck = this.identity.shouldRemember(userMessage);
    if (rememberCheck.should && rememberCheck.category) {
      this.identity.learnAboutUser(userMessage, rememberCheck.category);
    }

    // 3. 检测情感内容
    this.detectEmotion(userMessage);

    // 4. 构建上下文
    const context = this.context.getContext();

    // 5. 检索相关记忆（丰富上下文）
    const memories = await this.context.enrichWithMemory(userMessage);

    // 6. 让上层调用者构建提示词并调用 LLM
    const systemPrompt = this.buildSystemPrompt(context, memories);

    // 返回给调用者处理 LLM 调用
    return {
      response: systemPrompt,  // 实际是给 LLM 的 prompt
      context,
      shouldRemember: rememberCheck,
    };
  }

  /** Cola 回复后记录 */
  async speak(response: string): Promise<void> {
    this.conversationLog.push(`Cola: ${response}`);
    this.context.addMessage("assistant", response);
  }

  // ==================== 梦境接口 ====================

  /** 执行完整深度梦境 */
  async dreamTime(): Promise<DreamJournal> {
    const conversations = this.conversationLog.join("\n");
    return this.dream.dream(conversations || "今天没有对话记录");
  }

  /** 执行轻梦境（快速提取关键信息） */
  quickDream(message: string): void {
    this.dream.quickDream(message);
  }

  // ==================== 中断接口 ====================

  /** 暂停当前任务 */
  pauseTask(description: string, progress: string): TaskSnapshot {
    const snapshot = this.interrupt.freeze(description, progress);
    this.interrupt.switch();
    return snapshot;
  }

  /** 恢复被暂停的任务 */
  resumeTask(): TaskSnapshot | null {
    return this.interrupt.resume();
  }

  /** 完成当前任务 */
  completeTask(snapshotId: string): void {
    this.interrupt.complete(snapshotId);
  }

  /** 列出所有暂停的任务 */
  listPausedTasks(): TaskSnapshot[] {
    return this.interrupt.listFrozen();
  }

  // ==================== 身份接口 ====================

  /** 获取 Cola 的完整身份描述 */
  getIdentity(): string {
    return this.identity.getColaIdentity();
  }

  /** 获取 Core Identity 数据 */
  getCoreIdentity(): CoreIdentity {
    return this.store.getCoreIdentity();
  }

  /** 获取用户画像 */
  getUserProfile(): UserProfile {
    return this.store.getUserProfile();
  }

  /** 手动添加用户信息 */
  learnAboutUser(fact: string, category: "fact" | "preference" | "habit" | "goal"): void {
    this.identity.learnAboutUser(fact, category);
  }

  // ==================== 记忆接口 ====================

  /** 搜索记忆 */
  searchMemories(query: string, limit?: number): MemoryEntry[] {
    const { simpleEmbed } = require("./memory/store.ts");
    const vec = simpleEmbed(query);
    return this.store.searchByVector(vec, limit || 5).map(r => r.memory);
  }

  /** 获取最近的梦境日记 */
  getRecentDreams(limit?: number): DreamJournal[] {
    return this.store.getDreamJournals(limit || 7);
  }

  // ==================== 内部方法 ====================

  private detectEmotion(message: string): void {
    const emotionalKeywords = [
      { word: "难过", mood: "难过", intensity: 7 },
      { word: "开心", mood: "开心", intensity: 8 },
      { word: "焦虑", mood: "焦虑", intensity: 7 },
      { word: "担心", mood: "担心", intensity: 6 },
      { word: "激动", mood: "激动", intensity: 8 },
      { word: "害怕", mood: "害怕", intensity: 7 },
      { word: "感动", mood: "感动", intensity: 8 },
      { word: "生气", mood: "生气", intensity: 6 },
      { word: "失望", mood: "失望", intensity: 6 },
      { word: "幸福", mood: "幸福", intensity: 9 },
      { word: "累", mood: "疲惫", intensity: 5 },
      { word: "压力", mood: "压力大", intensity: 6 },
    ];

    for (const { word, mood, intensity } of emotionalKeywords) {
      if (message.includes(word)) {
        this.identity.recordEmotion(mood, `对话中检测到：${message.slice(0, 100)}`, intensity);
        break;
      }
    }
  }

  private buildSystemPrompt(context: ContextQuery, memories: MemoryEntry[]): string {
    let prompt = "";

    // Core identity
    prompt += this.identity.getColaIdentity() + "\n\n";

    // 今日梦境（如果有）
    if (context.relevantDreams.length > 0) {
      const todayDream = context.relevantDreams[0];
      if (todayDream.morningBriefing) {
        prompt += `[今日梦境提醒] ${todayDream.morningBriefing}\n\n`;
      }
    }

    // 活跃上下文
    prompt += `[当前上下文]\n${context.activeContext}\n\n`;

    // 检索到的相关记忆
    if (memories.length > 0) {
      prompt += "[相关记忆]\n";
      for (const mem of memories) {
        prompt += `- ${mem.summary || mem.content.slice(0, 200)}\n`;
      }
      prompt += "\n";
    }

    // 近期 checkpoint 摘要
    if (context.checkpoints.length > 0) {
      prompt += "[近期对话摘要]\n";
      for (const cp of context.checkpoints.slice(0, 3)) {
        prompt += `- ${cp.summary}\n`;
      }
    }

    return prompt;
  }

  /** 关闭数据库连接 */
  close(): void {
    this.store.close();
  }
}