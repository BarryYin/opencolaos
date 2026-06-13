/**
 * OpenColaOS — CLI 入口
 *
 * 提供命令行交互界面
 */

import { Cola } from "../cola.ts";

export async function runCLI() {
  const cola = new Cola({ name: "Cola" });
  const identity = cola.getCoreIdentity();

  console.log(`\n  🥤 OpenColaOS v${identity.version}`);
  console.log(`  ${identity.name}: "${identity.mission}"`);
  console.log("  " + "─".repeat(50));
  console.log("  命令: /dream 做梦 | /memory 搜记忆 | /status 状态 | /pause 暂停 | /resume 恢复 | quit 退出\n");

  const readline = (await import("node:readline")).createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> =>
    new Promise(resolve => readline.question(q, resolve));

  let running = true;

  while (running) {
    const input = await ask("你 > ");
    const cmd = input.trim();

    if (cmd === "quit" || cmd === "exit") {
      running = false;
      console.log("\n👋 再见！");
      break;
    }

    switch (true) {
      case cmd === "/dream": {
        console.log("🌙 Cola 开始做梦...");
        const journal = await cola.dreamTime();
        console.log(`\n📓 梦境日记 (${journal.date})`);
        console.log(`  话题: ${journal.keyTopics.join(", ")}`);
        console.log(`  用户状态: ${journal.userState.mood} | 精力: ${journal.userState.energy}`);
        console.log(`  提取任务: ${journal.tasksExtracted.length}`);
        console.log(`  新知: ${journal.newKnowledge.length}`);
        console.log(`  早安简报:\n${journal.morningBriefing}\n`);
        break;
      }

      case cmd.startsWith("/memory "): {
        const query = cmd.slice(8);
        const results = cola.searchMemories(query);
        console.log(`\n🔍 搜索记忆: "${query}"`);
        if (results.length === 0) {
          console.log("  没有找到相关记忆");
        } else {
          for (const mem of results) {
            console.log(`  [${mem.type}] ${mem.summary || mem.content.slice(0, 100)} (重要度: ${mem.importance})`);
          }
        }
        console.log();
        break;
      }

      case cmd === "/status": {
        const profile = cola.getUserProfile();
        const id = cola.getCoreIdentity();
        console.log(`\n📊 Cola 状态`);
        console.log(`  版本: v${id.version}`);
        console.log(`  关系阶段: ${profile.relationshipStage}`);
        console.log(`  关于用户: ${profile.facts.length} 条事实`);
        console.log(`  用户目标: ${profile.goals.length} 个`);
        console.log(`  情绪记录: ${profile.emotionalHistory.length} 条\n`);
        break;
      }

      case cmd.startsWith("/pause "): {
        const desc = cmd.slice(7);
        const snap = cola.pauseTask(desc, "已开始执行");
        console.log(`⏸️ 任务已暂停: ${snap.taskDescription}\n`);
        break;
      }

      case cmd === "/resume": {
        const snap = cola.resumeTask();
        if (snap) {
          console.log(`▶️ 恢复任务: ${snap.taskDescription}\n`);
        }
        break;
      }

      case cmd.startsWith("/learn "): {
        const info = cmd.slice(7);
        cola.learnAboutUser(info, "fact");
        console.log(`🧠 已记住: ${info}\n`);
        break;
      }

      default: {
        if (cmd) {
          // 正常对话
          const result = await cola.hear(cmd);

          // 打印给 LLM 的 prompt 预览（只显示前 200 字）
          console.log(`\n📋 上下文已构建 (${result.response.length} chars)`);
          console.log(`💡 响应预览:\n${result.response.slice(0, 300)}...\n`);

          // 模拟 Cola 回复（实际应调 LLM）
          const mockResponse = `(这里是 LLM 根据上述 context 生成的回复。实际使用时接入 Claude/GPT/本地模型)`;
          await cola.speak(mockResponse);
        }
        break;
      }
    }
  }

  readline.close();
  cola.close();
}

// 直接运行时启动 CLI
if (import.meta.main) {
  runCLI().catch(console.error);
}