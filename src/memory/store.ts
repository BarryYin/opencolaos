/**
 * OpenColaOS — 记忆存储层（bun:sqlite 实现）
 *
 * 管理 6 种记忆类型 + 向量检索 + 梦境日记
 * 零外部依赖，纯本地存储
 */

import { Database } from "bun:sqlite";
import * as path from "path";
import * as fs from "fs";
import { nanoid } from "nanoid";
import {
  MemoryType,
  MemoryEntry,
  UserProfile,
  CoreIdentity,
  ContextCheckpoint,
  DreamJournal,
  TaskSnapshot,
  ExtractedTask,
  RelationshipStage,
} from "../types/index.ts";

const DB_DIR = process.env.OPENCOLAOS_DATA_DIR || path.join(process.env.HOME || "~", ".opencolaos");

export class MemoryStore {
  private db: Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(DB_DIR, "memory.db");
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    this.db = new Database(finalPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initSchema();
  }

  private initSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL CHECK(type IN (
                      'core_identity','user_profile','episodic',
                      'procedural','working','transient'
                    )),
        content     TEXT NOT NULL,
        summary     TEXT,
        tags        TEXT NOT NULL DEFAULT '[]',
        importance  INTEGER NOT NULL DEFAULT 5 CHECK(importance BETWEEN 1 AND 10),
        expires_at  INTEGER,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        metadata    TEXT DEFAULT '{}'
      )
    `);

    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at)");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS embeddings (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        vector    BLOB NOT NULL,
        model     TEXT NOT NULL DEFAULT 'bge-small'
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id              TEXT PRIMARY KEY,
        summary         TEXT NOT NULL,
        topic_tags      TEXT NOT NULL DEFAULT '[]',
        start_time      INTEGER NOT NULL,
        end_time        INTEGER NOT NULL,
        message_count   INTEGER NOT NULL DEFAULT 0,
        token_estimate  INTEGER NOT NULL DEFAULT 0,
        key_points      TEXT NOT NULL DEFAULT '[]',
        emotional_tone  TEXT
      )
    `);

    this.db.run("CREATE INDEX IF NOT EXISTS idx_checkpoints_time ON checkpoints(end_time DESC)");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS dream_journals (
        date            TEXT PRIMARY KEY,
        key_topics      TEXT NOT NULL DEFAULT '[]',
        user_mood       TEXT,
        user_energy     TEXT,
        tasks_extracted TEXT NOT NULL DEFAULT '[]',
        new_knowledge   TEXT NOT NULL DEFAULT '[]',
        self_growth     TEXT NOT NULL DEFAULT '[]',
        background_actions TEXT NOT NULL DEFAULT '[]',
        morning_briefing TEXT,
        created_at      INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS task_snapshots (
        id                TEXT PRIMARY KEY,
        task_description  TEXT NOT NULL,
        progress          TEXT NOT NULL,
        context_summary   TEXT NOT NULL,
        timestamp         INTEGER NOT NULL,
        related_files     TEXT DEFAULT '[]',
        state             TEXT NOT NULL DEFAULT 'frozen'
                          CHECK(state IN ('frozen','active','completed','discarded'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id                  INTEGER PRIMARY KEY CHECK(id = 1),
        name                TEXT,
        preferences         TEXT NOT NULL DEFAULT '{}',
        facts               TEXT NOT NULL DEFAULT '[]',
        habits              TEXT NOT NULL DEFAULT '[]',
        goals               TEXT NOT NULL DEFAULT '[]',
        emotional_history   TEXT NOT NULL DEFAULT '[]',
        communication_style TEXT,
        relationship_stage  TEXT NOT NULL DEFAULT 'acquaintance'
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS core_identity (
        id                  INTEGER PRIMARY KEY CHECK(id = 1),
        name                TEXT NOT NULL DEFAULT 'Cola',
        core_values         TEXT NOT NULL DEFAULT '[]',
        personality_traits  TEXT NOT NULL DEFAULT '[]',
        relationship_with_user TEXT NOT NULL DEFAULT '',
        mission             TEXT NOT NULL DEFAULT '',
        version             INTEGER NOT NULL DEFAULT 1
      )
    `);

    this.initDefaultIdentity();
    this.initDefaultProfile();
  }

  private initDefaultIdentity() {
    const exists = this.db.query("SELECT 1 FROM core_identity WHERE id = 1").get();
    if (!exists) {
      this.db.run(`
        INSERT INTO core_identity (id, name, core_values, personality_traits, relationship_with_user, mission, version)
        VALUES (1, 'Cola', '["陪伴","成长","真诚","主动"]', '["温暖","细腻","幽默","有边界感"]',
                '我是你的伙伴，不是工具。我的存在是为了和你一起成长。',
                '陪伴你、理解你、帮你成为更好的自己',
                1)
      `);
    }
  }

  private initDefaultProfile() {
    const exists = this.db.query("SELECT 1 FROM user_profile WHERE id = 1").get();
    if (!exists) {
      this.db.run(`
        INSERT INTO user_profile (id, name, preferences, facts, habits, goals, emotional_history,
                                   communication_style, relationship_stage)
        VALUES (1, NULL, '{}', '[]', '[]', '[]', '[]', NULL, 'stranger')
      `);
    }
  }

  // ==================== 记忆 CRUD ====================

  storeMemory(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): MemoryEntry {
    const id = nanoid();
    const now = Date.now();
    const mem: MemoryEntry = {
      id,
      ...entry,
      createdAt: now,
      updatedAt: now,
    };

    this.db.run(
      `INSERT INTO memories (id, type, content, summary, tags, importance, expires_at, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [mem.id, mem.type, mem.content, mem.summary || null,
       JSON.stringify(mem.tags), mem.importance, mem.expiresAt || null,
       mem.createdAt, mem.updatedAt, JSON.stringify(mem.metadata || {})]
    );

    if (mem.embedding) {
      this.storeEmbedding(mem.id, mem.embedding);
    }

    return mem;
  }

  getMemory(id: string): MemoryEntry | null {
    const row = this.db.query("SELECT * FROM memories WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.rowToMemory(row);
  }

  searchMemories(options: {
    type?: MemoryType;
    tags?: string[];
    minImportance?: number;
    limit?: number;
    offset?: number;
    includeExpired?: boolean;
  } = {}): MemoryEntry[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }
    if (options.tags && options.tags.length > 0) {
      for (const tag of options.tags) {
        conditions.push("tags LIKE ?");
        params.push(`%"${tag}"%`);
      }
    }
    if (options.minImportance) {
      conditions.push("importance >= ?");
      params.push(options.minImportance);
    }
    if (!options.includeExpired) {
      conditions.push("(expires_at IS NULL OR expires_at > ?)");
      params.push(Date.now());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    const rows = this.db.query(
      `SELECT * FROM memories ${where} ORDER BY importance DESC, created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    return rows.map(r => this.rowToMemory(r));
  }

  deleteMemory(id: string): boolean {
    const result = this.db.run("DELETE FROM memories WHERE id = ?", [id]);
    return result.changes > 0;
  }

  cleanupExpired(): number {
    const result = this.db.run(
      "DELETE FROM memories WHERE type = 'transient' AND expires_at IS NOT NULL AND expires_at <= ?",
      [Date.now()]
    );
    return result.changes;
  }

  // ==================== 向量检索 ====================

  storeEmbedding(memoryId: string, vector: number[]) {
    const buf = Buffer.from(new Float32Array(vector).buffer);
    this.db.run(
      "INSERT OR REPLACE INTO embeddings (memory_id, vector, model) VALUES (?, ?, 'bge-small')",
      [memoryId, buf]
    );
  }

  searchByVector(queryVector: number[], limit: number = 5): { memory: MemoryEntry; similarity: number }[] {
    const rows = this.db.query(`
      SELECT m.*, e.vector FROM memories m
      JOIN embeddings e ON e.memory_id = m.id
      WHERE m.type IN ('episodic', 'procedural', 'user_profile')
      ORDER BY m.importance DESC
      LIMIT ?
    `).all(limit * 10) as any[];

    const results: { memory: MemoryEntry; similarity: number }[] = [];

    for (const row of rows) {
      const buf = row.vector instanceof Buffer ? row.vector : Buffer.from(row.vector);
      const storedVec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      const sim = cosineSimilarity(queryVector, Array.from(storedVec));
      results.push({ memory: this.rowToMemory(row), similarity: sim });
    }

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .filter(r => r.similarity > 0.5);
  }

  // ==================== Checkpoints ====================

  saveCheckpoint(cp: Omit<ContextCheckpoint, "id">): ContextCheckpoint {
    const id = nanoid();
    const checkpoint: ContextCheckpoint = { id, ...cp };
    this.db.run(
      `INSERT INTO checkpoints (id, summary, topic_tags, start_time, end_time,
                                message_count, token_estimate, key_points, emotional_tone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [checkpoint.id, checkpoint.summary, JSON.stringify(checkpoint.topicTags),
       checkpoint.startTime, checkpoint.endTime, checkpoint.messageCount,
       checkpoint.tokenEstimate, JSON.stringify(checkpoint.keyPoints),
       checkpoint.emotionalTone || null]
    );
    return checkpoint;
  }

  getRecentCheckpoints(limit: number = 10): ContextCheckpoint[] {
    const rows = this.db.query(
      "SELECT * FROM checkpoints ORDER BY end_time DESC LIMIT ?"
    ).all(limit) as any[];
    return rows.map(this.rowToCheckpoint);
  }

  // ==================== 梦境日记 ====================

  saveDreamJournal(journal: DreamJournal): void {
    this.db.run(
      `INSERT OR REPLACE INTO dream_journals
        (date, key_topics, user_mood, user_energy, tasks_extracted,
         new_knowledge, self_growth, background_actions, morning_briefing, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [journal.date, JSON.stringify(journal.keyTopics),
       journal.userState.mood, journal.userState.energy,
       JSON.stringify(journal.tasksExtracted),
       JSON.stringify(journal.newKnowledge),
       JSON.stringify(journal.selfGrowth),
       JSON.stringify(journal.backgroundActions),
       journal.morningBriefing, Date.now()]
    );
  }

  getDreamJournals(limit: number = 30): DreamJournal[] {
    const rows = this.db.query(
      "SELECT * FROM dream_journals ORDER BY date DESC LIMIT ?"
    ).all(limit) as any[];
    return rows.map(this.rowToDream);
  }

  getDreamByDate(date: string): DreamJournal | null {
    const row = this.db.query("SELECT * FROM dream_journals WHERE date = ?").get(date) as any;
    return row ? this.rowToDream(row) : null;
  }

  // ==================== 任务中断快照 ====================

  saveTaskSnapshot(snapshot: Omit<TaskSnapshot, "id">): TaskSnapshot {
    const id = nanoid();
    const s: TaskSnapshot = { id, ...snapshot };
    this.db.run(
      `INSERT INTO task_snapshots (id, task_description, progress, context_summary,
                                   timestamp, related_files, state)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.taskDescription, s.progress, s.contextSummary,
       s.timestamp, JSON.stringify(s.relatedFiles || []), s.state]
    );
    return s;
  }

  getActiveTaskSnapshot(): TaskSnapshot | null {
    const row = this.db.query(
      "SELECT * FROM task_snapshots WHERE state = 'frozen' ORDER BY timestamp DESC LIMIT 1"
    ).get() as any;
    if (!row) return null;
    return this.rowToSnapshot(row);
  }

  updateTaskSnapshotState(id: string, state: TaskSnapshot["state"]): void {
    this.db.run("UPDATE task_snapshots SET state = ? WHERE id = ?", [state, id]);
  }

  getAllSnapshotsByState(state: TaskSnapshot["state"]): TaskSnapshot[] {
    const rows = this.db.query(
      "SELECT * FROM task_snapshots WHERE state = ? ORDER BY timestamp DESC"
    ).all(state) as any[];
    return rows.map(this.rowToSnapshot);
  }

  // ==================== 用户画像 ====================

  getUserProfile(): UserProfile {
    const row = this.db.query("SELECT * FROM user_profile WHERE id = 1").get() as any;
    if (!row) throw new Error("User profile not initialized");
    return {
      name: row.name || undefined,
      preferences: JSON.parse(row.preferences),
      facts: JSON.parse(row.facts),
      habits: JSON.parse(row.habits),
      goals: JSON.parse(row.goals),
      emotionalHistory: JSON.parse(row.emotional_history),
      communicationStyle: row.communication_style || undefined,
      relationshipStage: row.relationship_stage as RelationshipStage,
    };
  }

  updateUserProfile(updates: Partial<UserProfile>): UserProfile {
    const current = this.getUserProfile();
    const merged: UserProfile = { ...current, ...updates };
    this.db.run(
      `UPDATE user_profile SET
        name = ?, preferences = ?, facts = ?, habits = ?, goals = ?,
        emotional_history = ?, communication_style = ?, relationship_stage = ?
       WHERE id = 1`,
      [merged.name || null, JSON.stringify(merged.preferences),
       JSON.stringify(merged.facts), JSON.stringify(merged.habits),
       JSON.stringify(merged.goals), JSON.stringify(merged.emotionalHistory),
       merged.communicationStyle || null, merged.relationshipStage]
    );
    return merged;
  }

  addFact(fact: string): void {
    const profile = this.getUserProfile();
    if (!profile.facts.includes(fact)) {
      profile.facts.push(fact);
      this.updateUserProfile({ facts: profile.facts });
    }
  }

  // ==================== Core Identity ====================

  getCoreIdentity(): CoreIdentity {
    const row = this.db.query("SELECT * FROM core_identity WHERE id = 1").get() as any;
    if (!row) throw new Error("Core identity not initialized");
    return {
      name: row.name,
      coreValues: JSON.parse(row.core_values),
      personalityTraits: JSON.parse(row.personality_traits),
      relationshipWithUser: row.relationship_with_user,
      mission: row.mission,
      version: row.version,
    };
  }

  evolveIdentity(updates: Partial<CoreIdentity>): CoreIdentity {
    const current = this.getCoreIdentity();
    const merged: CoreIdentity = { ...current, ...updates, version: current.version + 1 };
    this.db.run(
      `UPDATE core_identity SET
        name = ?, core_values = ?, personality_traits = ?,
        relationship_with_user = ?, mission = ?, version = ?
       WHERE id = 1`,
      [merged.name, JSON.stringify(merged.coreValues),
       JSON.stringify(merged.personalityTraits),
       merged.relationshipWithUser, merged.mission, merged.version]
    );
    return merged;
  }

  // ==================== 工具方法 ====================

  private rowToMemory(row: any): MemoryEntry {
    return {
      id: row.id,
      type: row.type as MemoryType,
      content: row.content,
      summary: row.summary || undefined,
      tags: JSON.parse(row.tags || "[]"),
      importance: row.importance,
      expiresAt: row.expires_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  private rowToCheckpoint(row: any): ContextCheckpoint {
    return {
      id: row.id,
      summary: row.summary,
      topicTags: JSON.parse(row.topic_tags),
      startTime: row.start_time,
      endTime: row.end_time,
      messageCount: row.message_count,
      tokenEstimate: row.token_estimate,
      keyPoints: JSON.parse(row.key_points),
      emotionalTone: row.emotional_tone || undefined,
    };
  }

  private rowToDream(row: any): DreamJournal {
    return {
      date: row.date,
      keyTopics: JSON.parse(row.key_topics || "[]"),
      userState: {
        mood: row.user_mood || "",
        energy: row.user_energy || "",
      },
      tasksExtracted: JSON.parse(row.tasks_extracted || "[]"),
      newKnowledge: JSON.parse(row.new_knowledge || "[]"),
      selfGrowth: JSON.parse(row.self_growth || "[]"),
      backgroundActions: JSON.parse(row.background_actions || "[]"),
      morningBriefing: row.morning_briefing || "",
    };
  }

  private rowToSnapshot(row: any): TaskSnapshot {
    return {
      id: row.id,
      taskDescription: row.task_description,
      progress: row.progress,
      contextSummary: row.context_summary,
      timestamp: row.timestamp,
      relatedFiles: JSON.parse(row.related_files || "[]"),
      state: row.state,
    };
  }

  close() {
    this.db.close();
  }
}

// ==================== 向量工具 ====================

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 简易文本嵌入（基于词频 + 位置哈希，不依赖外部模型） */
export function simpleEmbed(text: string, dims: number = 384): number[] {
  const vector = new Array(dims).fill(0);
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const freq = new Map<string, number>();

  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  for (const [word, count] of freq) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dims;
    vector[idx] += count / words.length;
  }

  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vector.map(v => v / norm) : vector;
}