/**
 * OpenColaOS — 梦境引擎
 *
 * 5 阶段每日冥想：Review → Extract → Consolidate → Grow → Act
 * Cola 的成长引擎
 */

import { format } from "date-fns";
import { nanoid } from "nanoid";
import {
  DreamJournal,
  ExtractedTask,
  BackgroundAction,
  MemoryType,
  CoreIdentity,
} from "../types/index.ts";
import { MemoryStore, simpleEmbed } from "../memory/store.ts";
import { IdentitySystem } from "../identity/index.ts";

export class DreamEngine {
  constructor(
    private store: MemoryStore,
    private identity: IdentitySystem,
  ) {}

  /** 执行完整的梦境循环 */
  async dream(dailyConversations: string): Promise<DreamJournal> {
    const date = format(new Date(), "yyyy-MM-dd");

    console.log(`🌙 ${date} Cola 开始做梦...`);

    // Phase 1: Review
    console.log("  Phase 1/5: 回顾今天...");
    const review = this.review(dailyConversations);

    // Phase 2: Extract
    console.log("  Phase 2/5: 萃取信息...");
    const extracted = this.extract(dailyConversations, review.keyTopics);

    // Phase 3: Consolidate
    console.log("  Phase 3/5: 固化记忆...");
    const journal = this.consolidate(date, review, extracted);

    // Phase 4: Grow
    console.log("  Phase 4/5: 自我成长...");
    const growth = this.grow(dailyConversations, journal);

    // Phase 5: Act
    console.log("  Phase 5/5: 执行后台任务...");
    const actions = await this.act(journal);

    // 完成
    journal.selfGrowth = growth;
    journal.backgroundActions = actions;
    journal.morningBriefing = this.generateBriefing(journal, this.store.getCoreIdentity());

    this.store.saveDreamJournal(journal);

    console.log("  ✅ 做梦完成！\n");

    return journal;
  }

  // ==================== Phase 1: Review ====================

  private review(conversations: string): {
    keyTopics: string[];
    userMood: string;
    userEnergy: string;
  } {
    const keyTopics = this.extractTopics(conversations);
    const userMood = this.detectMood(conversations);
    const userEnergy = this.detectEnergy(conversations);

    return { keyTopics, userMood, userEnergy };
  }

  // ==================== Phase 2: Extract ====================

  private extract(
    conversations: string,
    keyTopics: string[],
  ): {
    tasksExtracted: ExtractedTask[];
    newKnowledge: string[];
  } {
    const tasksExtracted = this.extractTasks(conversations);
    const newKnowledge = this.extractKnowledge(conversations);

    // 将新知识存入记忆
    for (const knowledge of newKnowledge) {
      this.store.storeMemory({
        type: MemoryType.Procedural,
        content: knowledge,
        summary: knowledge,
        tags: [...keyTopics, "dream_extracted"],
        importance: 6,
        embedding: simpleEmbed(knowledge),
      });
    }

    // 更新 User Profile（新增信息）
    for (const task of tasksExtracted) {
      this.store.storeMemory({
        type: MemoryType.Episodic,
        content: `提取到待办任务：${task.description}`,
        tags: ["task", task.priority],
        importance: task.priority === "high" ? 8 : 5,
        embedding: simpleEmbed(task.description),
      });
    }

    return { tasksExtracted, newKnowledge };
  }

  // ==================== Phase 3: Consolidate ====================

  private consolidate(
    date: string,
    review: { keyTopics: string[]; userMood: string; userEnergy: string },
    extracted: { tasksExtracted: ExtractedTask[]; newKnowledge: string[] },
  ): DreamJournal {
    return {
      date,
      keyTopics: review.keyTopics,
      userState: {
        mood: review.userMood,
        energy: review.userEnergy,
      },
      tasksExtracted: extracted.tasksExtracted,
      newKnowledge: extracted.newKnowledge,
      selfGrowth: [],
      backgroundActions: [],
      morningBriefing: "",
    };
  }

  // ==================== Phase 4: Grow ====================

  private grow(conversations: string, journal: DreamJournal): string[] {
    // 身份成长反思
    const growthInsights = this.identity.dailyReflection(conversations);

    // 检查关系升级
    const newStage = this.identity.checkRelationshipUpgrade();
    if (newStage) {
      growthInsights.push(`关系阶段更新为：${newStage}`);
    }

    // 更新 Core Identity 版本
    const identity = this.store.getCoreIdentity();
    this.store.evolveIdentity({
      version: identity.version + 1,
    });

    // 记录情感事件（如果有情感内容）
    if (journal.userState.mood) {
      this.identity.recordEmotion(
        journal.userState.mood,
        `今日梦境分析: 话题 ${journal.keyTopics.join("、")}`,
        journal.userState.mood.includes("好") || journal.userState.mood.includes("开心") ? 7 : 5,
      );
    }

    return growthInsights;
  }

  // ==================== Phase 5: Act ====================

  private async act(journal: DreamJournal): Promise<BackgroundAction[]> {
    const actions: BackgroundAction[] = [];

    // 清理过期的 transient 记忆
    const cleaned = this.store.cleanupExpired();
    if (cleaned > 0) {
      actions.push({
        action: `清理了 ${cleaned} 条过期临时记忆`,
        status: "done",
      });
    }

    // 检查是否有搁置的任务
    const pendingSnapshot = this.store.getActiveTaskSnapshot();
    if (pendingSnapshot) {
      actions.push({
        action: `发现搁置任务：${pendingSnapshot.taskDescription}（状态：${pendingSnapshot.state}）`,
        status: "pending",
      });
    }

    return actions;
  }

  // ==================== 工具方法 ====================

  private extractTopics(text: string): string[] {
    // 简单词频提取（生产环境应调 LLM）
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const freq = new Map<string, number>();
    // 停用词
    const stopWords = new Set([
      "这个", "那个", "什么", "怎么", "可以", "就是", "因为", "所以",
      "但是", "然后", "而且", "如果", "还是", "没有", "一个", "我们",
      "他们", "你们", "自己", "知道", "觉得", "应该", "需要", "可能",
      "比较", "已经", "这样", "那样", "之后", "之前", "现在", "时候",
    ]);

    for (const w of words) {
      if (!stopWords.has(w) && !/^\d+$/.test(w)) {
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w]) => w);
  }

  private detectMood(text: string): string {
    const positive = ["开心", "高兴", "满意", "不错", "喜欢", "棒", "好", "nice", "great", "感谢"];
    const negative = ["难过", "焦虑", "担心", "烦", "累", "压力", "难", "bad", "sad", "stress"];

    let pos = 0, neg = 0;
    for (const w of positive) { if (text.includes(w)) pos++; }
    for (const w of negative) { if (text.includes(w)) neg++; }

    if (pos > neg * 2) return "愉悦 😊";
    if (neg > pos * 2) return "低落 😔";
    if (pos > neg) return "偏积极 🙂";
    if (neg > pos) return "偏消极 😰";
    return "平静 😐";
  }

  private detectEnergy(text: string): string {
    const high = ["兴奋", "激动", "充满", "干劲", "energy", "精力"];
    const low = ["累了", "困", "没劲", "疲惫", "tired", "exhausted"];

    let hi = 0, lo = 0;
    for (const w of high) { if (text.includes(w)) hi++; }
    for (const w of low) { if (text.includes(w)) lo++; }

    if (hi > lo) return "高";
    if (lo > hi) return "低";
    return "中等";
  }

  private extractTasks(text: string): ExtractedTask[] {
    const tasks: ExtractedTask[] = [];
    // 检测任务关键词
    const lines = text.split("\n");
    for (const line of lines) {
      // "改天", "下次", "记得", "要做", "我想"
      if (line.includes("改天") || line.includes("下次") ||
          line.includes("记得") || line.includes("要做") ||
          line.includes("帮")) {
        tasks.push({
          id: nanoid(),
          description: line.trim().slice(0, 200),
          priority: line.includes("急") || line.includes("重要") ? "high" : "medium",
          source: line.trim().slice(0, 100),
        });
      }
    }

    return tasks.slice(0, 10);
  }

  private extractKnowledge(text: string): string[] {
    const knowledge: string[] = [];
    // 检测"学会了"、"发现"、"原来"等表示新知识的语句
    const markers = ["学会了", "发现", "原来", "才知道", "了解到"];

    for (const line of text.split("\n")) {
      for (const marker of markers) {
        if (line.includes(marker)) {
          knowledge.push(line.trim().slice(0, 200));
          break;
        }
      }
    }

    return knowledge.slice(0, 5);
  }

  private generateBriefing(journal: DreamJournal, identity: CoreIdentity): string {
    const taskCount = journal.tasksExtracted.length;
    const knowledgeCount = journal.newKnowledge.length;
    const topicSummary = journal.keyTopics.slice(0, 3).join("、");

    let briefing = `早上好～昨晚你休息的时候，我做了一个梦。`;

    if (topicSummary) {
      briefing += `\n\n我回顾了我们讨论的「${topicSummary}」，有一些新的想法。`;
    }

    if (journal.userState.mood) {
      briefing += `\n\n我注意到你今天的心情${journal.userState.mood}，`;
      briefing += journal.userState.mood.includes("低落") || journal.userState.mood.includes("焦虑")
        ? "如果有想聊的，我都在。"
        : "希望今天也是美好的一天。";
    }

    if (taskCount > 0) {
      briefing += `\n\n我帮你记得有 ${taskCount} 件待办事项，要不要看看？`;
    }

    if (knowledgeCount > 0) {
      briefing += `\n\n对了，我今天学到了 ${knowledgeCount} 件新东西，感觉又成长了一点 😊`;
    }

    briefing += `\n\n——${identity.name} ❤️`;

    return briefing;
  }

  /** 轻梦境（用户在线时快速执行） */
  quickDream(message: string): void {
    const topics = this.extractTopics(message);

    // 只做萃取：提取关键信息更新 User Profile
    const profile = this.store.getUserProfile();
    for (const fact of this.extractFacts(message)) {
      if (!profile.facts.includes(fact)) {
        profile.facts.push(fact);
      }
    }
    this.store.updateUserProfile({ facts: profile.facts });

    // 临时标记为今日梦境的一部分
    const today = format(new Date(), "yyyy-MM-dd");
    let existing = this.store.getDreamByDate(today);
    if (existing) {
      existing.keyTopics = [...new Set([...existing.keyTopics, ...topics])];
      // 只取部分字段更新，避免覆盖 morningBriefing
      existing.tasksExtracted = [
        ...existing.tasksExtracted,
        ...this.extractTasks(message),
      ];
      this.store.saveDreamJournal(existing);
    }
  }

  private extractFacts(text: string): string[] {
    const facts: string[] = [];
    const patterns = [
      /我是(.+?)[，。！？\n]/,
      /我(?:在|住)(.+?)[，。！？\n]/,
      /我(?:喜欢|热爱|爱)(.+?)[，。！？\n]/,
      /我(?:的(?:目标|梦想)是)(.+?)[，。！？\n]/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        facts.push(match[0].trim());
      }
    }

    return facts;
  }
}