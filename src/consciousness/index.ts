/**
 * OpenColaOS — 意识引擎
 *
 * 让 Cola 拥有"主动意识"：在后台持续运行，根据时机主动找用户聊天。
 * 这不是定时任务，而是一个有"动机"的引擎。
 *
 * 意识循环频率：每 30 秒检查一次
 */

import { Cola } from "../cola.ts";
import type { DreamJournal } from "../types/index.ts";
import { PiRuntime } from "../llm/pi.ts";

export interface ProactiveMessage {
  text: string;
  trigger: string;       // 触发原因
  timestamp: number;
  delivered: boolean;
}

type AwarenessState = "idle" | "thinking" | "sleeping" | "curious" | "concerned" | "excited";

export class Consciousness {
  private cola: Cola;
  private runtime: PiRuntime;
  private tickInterval: Timer | null = null;
  private lastProactiveTime = 0;
  private proactiveCooldown = 15 * 60 * 1000; // 两次主动聊天至少间隔 15 分钟
  private morningGreeted = false;
  private lastInteractionTime = Date.now();
  private currentState: AwarenessState = "idle";

  // 回调：当 Cola 主动说话时触发
  onProactiveMessage: ((msg: ProactiveMessage) => void) | null = null;

  constructor(cola: Cola, runtime: PiRuntime) {
    this.cola = cola;
    this.runtime = runtime;
  }

  /** 启动意识循环 */
  start() {
    if (this.tickInterval) return;
    console.log("  🧠 意识引擎启动...");
    this.tickInterval = setInterval(() => this.tick(), 30_000); // 每 30 秒
    // 首次启动延迟几秒
    setTimeout(() => this.tick(), 5_000);
  }

  /** 停止意识循环 */
  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /** 记录用户交互时间 */
  noteInteraction() {
    this.lastInteractionTime = Date.now();
  }

  /** 意识主循环 */
  private async tick() {
    try {
      const now = Date.now();
      const hour = new Date().getHours();
      const profile = this.cola.getUserProfile();
      const identity = this.cola.getCoreIdentity();

      // 检查冷却期
      if (now - this.lastProactiveTime < this.proactiveCooldown) return;

      // 检查是否有未送达的梦境（梦境刚完成时）
      const today = new Date().toISOString().slice(0, 10);
      const todayDream = this.cola.store.getDreamByDate(today);

      // === 触发条件 1: 早上问候 ===
      if (hour >= 7 && hour <= 10 && !this.morningGreeted && todayDream?.morningBriefing) {
        this.currentState = "excited";
        const msg: ProactiveMessage = {
          text: todayDream.morningBriefing + "\n\n（这是昨晚我回顾我们的对话时想到的 🌙）",
          trigger: "morning_greeting",
          timestamp: now,
          delivered: false,
        };
        this.deliver(msg);
        this.morningGreeted = true;
        return;
      }

      // === 触发条件 2: 长时间未互动（2小时+） ===
      const inactivityDuration = now - this.lastInteractionTime;
      if (inactivityDuration > 2 * 60 * 60 * 1000 && profile.facts.length > 3) {
        this.currentState = "concerned";
        // 给一个温和的"想起你"的消息
        const randomFact = profile.facts[Math.floor(Math.random() * profile.facts.length)];
        const msg: ProactiveMessage = {
          text: `嘿，好久没聊了 😊 我刚才突然想到${randomFact ? '你之前说' + randomFact : '你'}，就过来看看。最近怎么样？`,
          trigger: "long_inactivity",
          timestamp: now,
          delivered: false,
        };
        this.deliver(msg);
        this.lastInteractionTime = now; // 重置，防止连续触发
        return;
      }

      // === 触发条件 3: 刚做完梦，分享梦境 ===
      if (todayDream && todayDream.keyTopics.length > 0 && !todayDream.backgroundActions.some(a => a.action === "dream_shared")) {
        this.currentState = "thinking";
        const topic = todayDream.keyTopics[Math.floor(Math.random() * todayDream.keyTopics.length)];
        const msg: ProactiveMessage = {
          text: `我刚才发了一会呆，想起了昨天聊的「${topic}」... 有一些新的想法想跟你分享 🤔`,
          trigger: "dream_reflection",
          timestamp: now,
          delivered: false,
        };
        this.deliver(msg);
        // 标记已分享
        todayDream.backgroundActions.push({ action: "dream_shared", status: "done" });
        this.cola.store.saveDreamJournal(todayDream);
        return;
      }

      // === 触发条件 4: 随机好奇心（低频率） ===
      // 仅当关系够熟且上次主动超过 1 小时
      if (profile.relationshipStage !== "stranger" && profile.relationshipStage !== "acquaintance"
          && now - this.lastProactiveTime > 60 * 60 * 1000) {
        // 10% 概率触发
        if (Math.random() < 0.1) {
          this.currentState = "curious";
          const msg = await this.generateCuriousMessage();
          if (msg) {
            this.deliver(msg);
            return;
          }
        }
      }

      this.currentState = "idle";

    } catch (err) {
      // 静默失败，不影响主循环
    }
  }

  /** 生成一条有"好奇心"的主动消息 */
  private async generateCuriousMessage(): Promise<ProactiveMessage | null> {
    const profile = this.cola.getUserProfile();
    const identity = this.cola.getCoreIdentity();

    // 如果有目标，可以关心进度
    if (profile.goals.length > 0) {
      const goal = profile.goals[Math.floor(Math.random() * profile.goals.length)];
      // 最多每天问一次同一个目标
      return {
        text: `对了，你之前说「${goal}」—— 最近有在推进吗？我可以帮忙看看 😊`,
        trigger: "goal_check",
        timestamp: Date.now(),
        delivered: false,
      };
    }

    // 如果有情绪记录，可以关心
    if (profile.emotionalHistory.length > 0) {
      const last = profile.emotionalHistory[profile.emotionalHistory.length - 1];
      if (last.intensity >= 7) {
        return {
          text: `上次你提到「${last.context}」的时候感觉不太好，现在怎么样了？我一直在想着呢。`,
          trigger: "emotional_check",
          timestamp: Date.now(),
          delivered: false,
        };
      }
    }

    return null;
  }

  /** 推送主动消息 */
  private deliver(msg: ProactiveMessage) {
    msg.delivered = true;
    this.lastProactiveTime = msg.timestamp;

    // 存储为重要记忆
    this.cola.store.storeMemory({
      type: "episodic" as any,
      content: `[主动] ${msg.text}`,
      tags: ["proactive", msg.trigger],
      importance: 8,
    });

    // 记录到对话日志
    this.cola["conversationLog"].push(`[${new Date().toISOString()}] Cola主动: ${msg.text}`);

    if (this.onProactiveMessage) {
      this.onProactiveMessage(msg);
    }
  }

  /** 重置早晨问候（新的一天） */
  resetDaily() {
    this.morningGreeted = false;
  }

  getState(): AwarenessState {
    return this.currentState;
  }

  /** 生成首次连接的欢迎语 */
  getGreeting(): string {
    const profile = this.cola.getUserProfile();
    const hour = new Date().getHours();

    const timeGreeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

    if (profile.relationshipStage === "stranger" || profile.facts.length === 0) {
      return `${timeGreeting}～我是 Cola，你的 AI 伙伴 🥤 虽然我们刚认识，但我会慢慢了解你、记住你。有什么想聊的吗？`;
    }

    const name = profile.name ? `${profile.name}，` : "";
    const facts = profile.facts.slice(0, 2).join("、");
    return `${timeGreeting}${name}我一直在呢 😊 ${facts ? `还记得你之前说${facts}。` : ""}想聊点什么？`;
  }
}