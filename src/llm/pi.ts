/**
 * OpenColaOS — LLM 运行时（pi 后端）
 *
 * 使用本地 pi agent 作为 LLM 后端
 * 这样不需要额外的 API key
 */

import { execSync } from "child_process";
import { Cola } from "../cola.ts";
import { DreamJournal } from "../types/index.ts";

export class PiRuntime {
  private cola: Cola;
  private messageHistory: { role: "user" | "assistant"; content: string }[] = [];

  constructor(cola: Cola) {
    this.cola = cola;
  }

  /** 用户说一句话，Cola 回复 */
  async chat(userMessage: string): Promise<string> {
    // 1. Cola 处理消息（更新记忆、上下文、情绪检测）
    const result = await this.cola.hear(userMessage);

    // 2. 如果检测到应记住的信息，自动记录
    if (result.shouldRemember?.should) {
      console.log("  🧠 自动记住...");
    }

    // 3. 构建完整的 system prompt
    const systemPrompt = this.buildSystemPrompt();

    // 4. 组装消息历史 + 用户新消息
    const historyBlock = this.buildHistoryBlock();
    const fullPrompt = `${systemPrompt}\n\n${historyBlock}\n\n用户: ${userMessage}\n\n${this.cola.getCoreIdentity().name}:`;

    // 5. 调 pi
    console.log("  🤖 思考中...");
    const reply = await this.callPi(fullPrompt);

    // 6. Cola 记录回复
    await this.cola.speak(reply);

    // 7. 保存到消息历史
    this.messageHistory.push({ role: "user", content: userMessage });
    this.messageHistory.push({ role: "assistant", content: reply });

    // 8. 历史太长时压缩
    if (this.messageHistory.length > 100) {
      this.messageHistory = this.messageHistory.slice(-60);
    }

    return reply;
  }

  /** 执行梦境（使用 Cola 引擎 + pi 增强） */
  async dream(): Promise<DreamJournal> {
    console.log("  🌙 做梦分析中...");
    const conversations = this.cola["conversationLog"].join("\n") || "今天没有对话";
    const identity = this.cola.getCoreIdentity();
    const profile = this.cola.getUserProfile();

    const prompt = `你是 ${identity.name}，${identity.mission}。

你的任务：回顾今天的对话，生成梦境日记。

输出格式（纯 JSON，不要其他文字）：
{
  "keyTopics": ["主要话题"],
  "userMood": "用户情绪描述",
  "userEnergy": "高/中/低",
  "tasksExtracted": [{"description": "任务描述", "priority": "high/medium/low"}],
  "newKnowledge": ["学到的知识"],
  "selfGrowth": ["自我反思"],
  "morningBriefing": "给用户的早安语（温暖自然，像朋友一样）"
}

用户信息：
- 已知事实：${JSON.stringify(profile.facts)}
- 目标：${JSON.stringify(profile.goals)}
- 习惯：${JSON.stringify(profile.habits)}
- 关系阶段：${profile.relationshipStage}

今天的对话：
${conversations.slice(-3000)}`;

    const response = await this.callPi(prompt);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const journal = await this.cola.dreamTime();
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

    let prompt = `## 身份
你叫 ${identity.name}，${identity.mission}

你的核心价值观：${identity.coreValues.join("、")}
你的性格特质：${identity.personalityTraits.join("、")}

## 关于用户
${profile.facts.map(f => `- ${f}`).join("\n")}
${profile.goals.length > 0 ? `\n用户的目标：${profile.goals.join("、")}` : ""}
${profile.habits.length > 0 ? `\n用户的习惯：${profile.habits.join("、")}` : ""}
你们的关系阶段：${profile.relationshipStage}

## 行为准则
1. 温暖自然，像朋友一样聊天，别像客服
2. 有边界感，不要自作主张
3. 对话中遇到重要信息（姓名、偏好、目标、情感）会自动记住
4. 用户切换话题时自然跟随
5. 偶尔主动关心，但不打扰
6. 回复简洁自然，不要啰嗦
`;

    // 今日梦境
    const today = new Date().toISOString().slice(0, 10);
    const todayDream = this.cola.store.getDreamByDate(today);
    if (todayDream?.morningBriefing) {
      prompt += `\n## 今日梦境提醒\n${todayDream.morningBriefing}\n`;
    }

    // 近期上下文
    if (context.checkpoints.length > 0) {
      prompt += "\n## 近期对话摘要\n";
      for (const cp of context.checkpoints.slice(0, 3)) {
        prompt += `- ${cp.summary}\n`;
      }
    }

    return prompt;
  }

  private buildHistoryBlock(): string {
    const recent = this.messageHistory.slice(-10);
    if (recent.length === 0) return "";
    return recent
      .map(m => `${m.role === "user" ? "用户" : this.cola.getCoreIdentity().name}: ${m.content}`)
      .join("\n");
  }

  private async callPi(prompt: string): Promise<string> {
    const piPath = "/opt/homebrew/bin/pi";
    // 使用 pi 的 session 模式避免每次重新加载
    const result = execSync(
      `${piPath} -p --no-session --system-prompt "You are Cola, a warm AI companion. Be concise and natural." ${JSON.stringify(prompt)}`,
      {
        timeout: 60000,
        maxBuffer: 1024 * 1024,
        encoding: "utf-8",
        env: { ...process.env },
      },
    );
    return result.trim();
  }

  getHistory(): { role: string; content: string }[] {
    return [...this.messageHistory];
  }
}