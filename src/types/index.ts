/**
 * OpenColaOS — 核心类型定义
 */

/** 记忆类型枚举 */
export enum MemoryType {
  CoreIdentity = "core_identity",
  UserProfile = "user_profile",
  Episodic = "episodic",
  Procedural = "procedural",
  Working = "working",
  Transient = "transient",
}

/** 记忆条目 */
export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;          // 结构化内容（JSON string）或纯文本
  summary?: string;         // 用于检索的摘要
  embedding?: number[];     // 向量嵌入
  tags: string[];
  importance: number;       // 1-10 重要性
  expiresAt?: number;       // Transient 类型的到期时间戳
  createdAt: number;        // unix ms
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/** 用户画像 */
export interface UserProfile {
  name?: string;
  preferences: Record<string, unknown>;
  facts: string[];           // "用户喜欢 Python"
  habits: string[];          // "用户习惯夜间工作"
  goals: string[];           // "用户想学 Rust"
  emotionalHistory: EmotionalRecord[];
  communicationStyle?: string;
  relationshipStage: RelationshipStage;
}

export enum RelationshipStage {
  Stranger = "stranger",
  Acquaintance = "acquaintance",
  Familiar = "familiar",
  Trusted = "trusted",
  Deep = "deep",       // 挚友/伙伴级
}

export interface EmotionalRecord {
  date: string;       // YYYY-MM-DD
  mood: string;       // 情绪描述
  context: string;    // 触发背景
  intensity: number;  // 1-10
}

/** Core Identity — Cola 的"灵魂" */
export interface CoreIdentity {
  name: string;
  coreValues: string[];
  personalityTraits: string[];
  relationshipWithUser: string;
  mission: string;
  version: number;       // 用于追踪成长
}

/** Checkpoint — 上下文快照 */
export interface ContextCheckpoint {
  id: string;
  summary: string;
  topicTags: string[];
  startTime: number;
  endTime: number;
  messageCount: number;
  tokenEstimate: number;
  keyPoints: string[];
  emotionalTone?: string;
}

/** 梦境日记 */
export interface DreamJournal {
  date: string;                        // YYYY-MM-DD
  keyTopics: string[];
  userState: { mood: string; energy: string };
  tasksExtracted: ExtractedTask[];
  newKnowledge: string[];
  selfGrowth: string[];
  backgroundActions: BackgroundAction[];
  morningBriefing: string;
}

export interface ExtractedTask {
  id: string;
  description: string;
  priority: "low" | "medium" | "high";
  dueDate?: string;
  source: string;      // 对话中哪里提取的
}

export interface BackgroundAction {
  action: string;
  status: "pending" | "done" | "failed";
  result?: string;
}

/** 中断快照 */
export interface TaskSnapshot {
  id: string;
  taskDescription: string;
  progress: string;
  contextSummary: string;
  timestamp: number;
  relatedFiles?: string[];
  state: "frozen" | "active" | "completed" | "discarded";
}

/** 上下文查询结果 */
export interface ContextQuery {
  query: string;
  activeContext: string;  // 当前工作记忆
  checkpoints: ContextCheckpoint[];
  retrievedMemories: MemoryEntry[];
  relevantDreams: DreamJournal[];
}
