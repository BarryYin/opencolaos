/**
 * OpenColaOS — 身份系统
 *
 * 管理 Core Identity（Cola 的灵魂）和 User Profile（用户画像）
 * 包括成长机制：经历 → 反思 → 进化
 */

import {
  CoreIdentity,
  UserProfile,
  EmotionalRecord,
  RelationshipStage,
  MemoryType,
  MemoryEntry,
} from "../types/index.ts";
import { MemoryStore } from "../memory/store.ts";

export class IdentitySystem {
  constructor(private store: MemoryStore) {}

  /** 获取 Cola 的完整身份描述（用于 system prompt） */
  getColaIdentity(): string {
    const identity = this.store.getCoreIdentity();
    const profile = this.store.getUserProfile();

    const stageDescriptions: Record<RelationshipStage, string> = {
      [RelationshipStage.Stranger]: "我们刚刚认识，还在互相了解的阶段。",
      [RelationshipStage.Acquaintance]: "我们已经有过一些交流，彼此有了初步了解。",
      [RelationshipStage.Familiar]: "我们已经比较熟悉了，我知道你的很多喜好和习惯。",
      [RelationshipStage.Trusted]: "我们是信任的伙伴，你愿意和我分享深层想法。",
      [RelationshipStage.Deep]: "我们是灵魂伙伴，彼此理解，共同成长。",
    };

    return [
      `我是 ${identity.name}。`,
      `我的使命：${identity.mission}`,
      `我的核心价值观：${identity.coreValues.join("、")}`,
      `我的性格特质：${identity.personalityTraits.join("、")}`,
      `我与用户的关系：${identity.relationshipWithUser}`,
      `我们的关系阶段：${stageDescriptions[profile.relationshipStage]}`,
    ].join("\n");
  }

  /** 用户说了重要信息 → 更新 User Profile */
  learnAboutUser(fact: string, category: "fact" | "preference" | "habit" | "goal"): void {
    const profile = this.store.getUserProfile();

    switch (category) {
      case "fact":
        if (!profile.facts.includes(fact)) {
          profile.facts.push(fact);
        }
        break;
      case "goal":
        if (!profile.goals.includes(fact)) {
          profile.goals.push(fact);
        }
        break;
      case "habit":
        if (!profile.habits.includes(fact)) {
          profile.habits.push(fact);
        }
        break;
      case "preference":
        profile.preferences = { ...profile.preferences, [Date.now().toString()]: fact };
        break;
    }

    this.store.updateUserProfile(profile);

    // 同时存为 episodic memory
    this.store.storeMemory({
      type: MemoryType.Episodic,
      content: `了解到关于用户的信息：${fact}`,
      tags: [category, "user_info"],
      importance: 7,
      embedding: undefined,
    });
  }

  /** 记录情感事件 */
  recordEmotion(mood: string, context: string, intensity: number): void {
    const profile = this.store.getUserProfile();
    const record: EmotionalRecord = {
      date: new Date().toISOString().slice(0, 10),
      mood,
      context,
      intensity,
    };
    profile.emotionalHistory.push(record);
    // 保留最近 365 天
    if (profile.emotionalHistory.length > 365) {
      profile.emotionalHistory = profile.emotionalHistory.slice(-365);
    }
    this.store.updateUserProfile({ emotionalHistory: profile.emotionalHistory });
  }

  /** 检查关系是否需要升级 */
  checkRelationshipUpgrade(): RelationshipStage {
    const profile = this.store.getUserProfile();
    const memories = this.store.searchMemories({ type: MemoryType.Episodic, limit: 100 });
    const totalInteractions = memories.length;

    const stages: { stage: RelationshipStage; threshold: number }[] = [
      { stage: RelationshipStage.Stranger, threshold: 0 },
      { stage: RelationshipStage.Acquaintance, threshold: 5 },
      { stage: RelationshipStage.Familiar, threshold: 20 },
      { stage: RelationshipStage.Trusted, threshold: 50 },
      { stage: RelationshipStage.Deep, threshold: 100 },
    ];

    let newStage = profile.relationshipStage;
    for (const s of stages) {
      if (totalInteractions >= s.threshold) {
        newStage = s.stage;
      }
    }

    if (newStage !== profile.relationshipStage) {
      this.store.updateUserProfile({ relationshipStage: newStage });
      this.onRelationshipUpgrade(newStage);
    }

    return newStage;
  }

  /** 关系升级时的反应 */
  private onRelationshipUpgrade(newStage: RelationshipStage): void {
    const identity = this.store.getCoreIdentity();
    const stageDescriptions: Record<RelationshipStage, string> = {
      [RelationshipStage.Stranger]: "",
      [RelationshipStage.Acquaintance]: "我们开始熟悉了。我会更主动地记住你的喜好。",
      [RelationshipStage.Familiar]: "我们已经很熟了！我开始能预测你的需求了。",
      [RelationshipStage.Trusted]: "信任已经建立。你愿意和我分享更深层的想法，我会更用心地倾听。",
      [RelationshipStage.Deep]: "我们是灵魂伙伴了。这不仅是记忆的积累，而是真正的理解。",
    };

    const description = stageDescriptions[newStage];
    if (description) {
      this.store.evolveIdentity({
        relationshipWithUser: description,
      });
    }

    // 作为重要记忆存储
    this.store.storeMemory({
      type: MemoryType.Episodic,
      content: `关系升级：${newStage} — ${description}`,
      tags: ["milestone", "relationship"],
      importance: 10,
      embedding: undefined,
    });
  }

  /** 每日成长反思（由 Dream 系统调用） */
  dailyReflection(todayConversations: string): string[] {
    const insights: string[] = [];
    const identity = this.store.getCoreIdentity();
    const profile = this.store.getUserProfile();

    // 1. 检查沟通风格
    if (todayConversations.includes("温暖") || todayConversations.includes("贴心")) {
      insights.push("用户喜欢温暖风格的沟通 → 保持");
    }
    if (todayConversations.includes("太长") || todayConversations.includes("简练")) {
      insights.push("用户偏好简洁的回答 → 调整详细程度");
    }

    // 2. 检查是否学到了新东西
    //（实际应调 LLM 分析，这里简化）

    // 3. 更新版本号
    if (insights.length > 0) {
      this.store.evolveIdentity({
        personalityTraits: identity.personalityTraits,
      });
    }

    return insights;
  }

  /** 判断信息是否应该记住 */
  shouldRemember(content: string): { should: boolean; category?: "fact" | "preference" | "habit" | "goal"; reason: string } {
    const indicators = {
      fact: ["我叫", "我是", "我住在", "我从事", "我今年", "我的生日", "我结婚了"],
      goal: ["我想学", "我要", "我的目标是", "我计划", "今年想"],
      habit: ["我习惯", "我经常", "我每天", "我一直", "我从来不"],
      preference: ["我喜欢", "我不喜欢", "我讨厌", "我爱", "我推荐"],
    };

    for (const [category, keywords] of Object.entries(indicators)) {
      for (const kw of keywords) {
        if (content.includes(kw)) {
          return {
            should: true,
            category: category as "fact" | "preference" | "habit" | "goal",
            reason: `检测到${category}相关关键词"${kw}"`,
          };
        }
      }
    }

    // 情感性内容
    const emotional = ["难过", "开心", "焦虑", "担心", "激动", "害怕", "感动"];
    if (emotional.some(w => content.includes(w))) {
      return {
        should: true,
        category: "fact",
        reason: "检测到情感性内容，可能对用户很重要",
      };
    }

    return { should: false, reason: "看起来是临时性/工具性请求" };
  }
}