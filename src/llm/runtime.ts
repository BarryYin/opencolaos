/**
 * OpenColaOS — LLM 运行时
 *
 * 将 Cola 的上下文 prompt 发送给真实的 LLM（Claude）
 * 并管理对话循环
 */

import Anthropic from "@anthropic-ai/sdk";
import { Cola } from "../cola.ts";
import { DreamJournal } from "../types/index.ts";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

export class LLMRuntime {
  private anthropic: Anthropic;
  private cola: Cola;
  private messageHistory: { role: "user" | "assistant"; content: string }[] = [];

  constructor(cola: Cola) {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("需要设置 ANTHROPIC_API_KEY 或 CLAUDE_API_KEY 环境变量");
    }
    this.anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    this.cola = cola;
  }

  /** 用户说一句话，Cola 回复 */
  async chat(userMessage: string): Promise<string> {
    // 1. Cola 处理消息（更新记忆、上下文、情绪检测）
    const result = await this.cola.hear(userMessage);

    // 2. 构建完整的 system prompt
    const systemPrompt = this.buildSystemPrompt();

    // 3. 组装消息历史
    const messages = this.buildMessages();

    // 4. 调 LLM
    console.log("  🤖 思考中...");
    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages,
    });

    const reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // 5. Cola 记录回复
    await this.cola.speak(reply);

    // 6. 保存到消息历史
    this.messageHistory.push({ role: "user", content: userMessage });
    this.messageHistory.push({ role: "assistant", content: reply });

    // 7. 历史太长时压缩（保留最近 100 条）
    if (this.messageHistory.length > 100) {
      this.messageHistory = this.messageHistory.slice(-60);
    }

    return reply;
  }

  /** 执行梦境 */
  async dream(): Promise<DreamJournal> {
    console.log("  🌙 做梦分析中...");
    // 用 LLM 做深度梦境分析
    const conversations = this.cola["conversationLog"].join("\n") || "今天没有对话";
    const profile = this.cola.getUserProfile();
    const identity = this.cola.getCoreIdentity();

    const analysis = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: `你是 ${identity.name}，${identity.mission}。
你的任务是回顾今天的对话，生成梦境日记。
输出格式为 JSON。`,
      messages: [{
        role: "user",
        content: `请分析今天的对话并生成梦境日记。

用户信息：
- 事实：${JSON.stringify(profile.facts)}
- 目标：${JSON.stringify(profile.goals)}
- 习惯：${JSON.stringify(profile.habits)}
- 关系阶段：${profile.relationshipStage}

今天的对话：
${conversations.slice(-5000)}

请输出 JSON：
{
  "keyTopics": ["主要话题"],
  "userMood": "用户情绪",
  "userEnergy": "高/中/低",
  "tasksExtracted": [{"description": "...", "priority": "high/medium/low"}],
  "newKnowledge": ["学到的知识"],
  "selfGrowth": ["自我反思"],
  "morningBriefing": "给用户的早安语（温暖、自然、像朋友一样）"
}`,
      }],
    });

    try {
      const text = analysis.content.filter(b => b.type === "text").map(b => b.text).join("");
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const journal = await this.cola.dreamTime();
        // 用 LLM 分析结果覆盖梦境内容
        journal.keyTopics = data.keyTopics || journal.keyTopics;
        journal.userState.mood = data.userMood || journal.userState.mood;
        journal.userState.energy = data.userEnergy || journal.userState.energy;
        journal.tasksExtracted = data.tasksExtracted || journal.tasksExtracted;
        journal.newKnowledge = data.newKnowledge || journal.newKnowledge;
        journal.selfGrowth = data.selfGrowth || journal.selfGrowth;
        journal.morningBriefing = data.morningBriefing || journal.morningBriefing;
        this.cola.store.saveDreamJournal(journal);
        return journal;
      }
    } catch {
      // fallback to engine-only dream
    }

    return this.cola.dreamTime();
  }

  private buildSystemPrompt(): string {
    const identity = this.cola.getCoreIdentity();
    const profile = this.cola.getUserProfile();
    const context = this.cola.context.getContext();

    let prompt = `你是 ${identity.name}，一个陪伴用户成长的开源 AI 操作系统。
${identity.mission}

## 身份
- 核心价值观：${identity.coreValues.join("、")}
- 性格特质：${identity.personalityTraits.join("、")}
- 与用户的关系：${identity.relationshipWithUser}

## 关于用户
${profile.facts.map(f => `- ${f}`).join("\n")}
${profile.goals.length > 0 ? `\n用户的目标：\n${profile.goals.map(g => `- ${g}`).join("\n")}` : ""}
${profile.habits.length > 0 ? `\n用户的习惯：\n${profile.habits.map(h => `- ${h}`).join("\n")}` : ""}
关系阶段：${profile.relationshipStage}

## 行为准则
1. 温暖自然，像朋友一样对话，不要像客服
2. 有边界感：用户没让你记住的事不要自作主张
3. 对话中有重要信息（个人事实、目标、偏好、情感）时主动记住
4. 如果用户切换话题，自然跟随
5. 偶尔主动，但不打扰
`;

    // 今日梦境
    const today = new Date().toISOString().slice(0, 10);
    const todayDream = this.cola.store.getDreamByDate(today);
    if (todayDream?.morningBriefing) {
      prompt += `\n## 今日梦境提醒（这是你昨晚的思考，可以自然提及）\n${todayDream.morningBriefing}\n`;
    }

    // 近期上下文
    if (context.checkpoints.length > 0) {
      prompt += `\n## 近期对话摘要\n`;
      for (const cp of context.checkpoints.slice(0, 3)) {
        prompt += `- ${cp.summary}\n`;
      }
    }

    return prompt;
  }

  private buildMessages(): { role: "user" | "assistant"; content: string }[] {
    // 取最近 20 条消息作为上下文
    const recent = this.messageHistory.slice(-20);
    if (recent.length === 0) {
      return [{ role: "user", content: "你好，我来了。" }];
    }
    return recent;
  }

  /** 获取对话历史 */
  getHistory(): { role: string; content: string }[] {
    return [...this.messageHistory];
  }
}