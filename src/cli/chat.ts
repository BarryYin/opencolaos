/**
 * OpenColaOS — Chat CLI
 *
 * 真正和 Cola 对话的交互界面
 */

import { Cola } from "../cola.ts";
import { PiRuntime } from "../llm/pi.ts";

function printBanner(cola: Cola) {
  const id = cola.getCoreIdentity();
  const profile = cola.getUserProfile();
  console.log(`\n`);
  console.log(`  🥤 OpenColaOS v${id.version}`);
  console.log(`  ${id.name}: "${id.mission}"`);
  console.log(`  关系阶段: ${profile.relationshipStage}`);
  console.log(`  用户事实: ${profile.facts.length} 条`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  命令:  /dream 做梦  |  /status 状态  |  /remember 记住`);
  console.log(`        /search <关键词> 搜记忆 |  /dreams 梦境日记`);
  console.log(`        quit 退出`);
  console.log("");
}

async function main() {
  const cola = new Cola({ name: "Cola" });
  const runtime = new PiRuntime(cola);

  printBanner(cola);

  const readline = (await import("node:readline")).createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => readline.question(q, resolve));

  let running = true;

  while (running) {
    const input = await ask("你 > ");
    const cmd = input.trim();

    if (!cmd) continue;

    switch (true) {
      case cmd === "quit" || cmd === "exit":
        running = false;
        console.log("\n👋 再见！");
        break;

      case cmd === "/dream": {
        console.log("\n🌙 Cola 进入梦境...");
        const journal = await runtime.dream();
        console.log(`\n📓 梦境日记 (${journal.date})`);
        console.log(`  话题: ${journal.keyTopics.join(", ")}`);
        console.log(`  用户状态: ${journal.userState.mood} | 精力: ${journal.userState.energy}`);
        if (journal.tasksExtracted.length > 0) {
          console.log(`  提取任务:`);
          for (const t of journal.tasksExtracted) {
            console.log(`    [${t.priority}] ${t.description}`);
          }
        }
        if (journal.morningBriefing) {
          console.log(`\n  💌 早安简报:\n  ${journal.morningBriefing.replace(/\n/g, "\n  ")}`);
        }
        console.log();
        break;
      }

      case cmd === "/status": {
        const p = cola.getUserProfile();
        const id = cola.getCoreIdentity();
        console.log(`\n📊 状态`);
        console.log(`  Cola 版本: v${id.version}`);
        console.log(`  关系阶段: ${p.relationshipStage}`);
        console.log(`  用户事实: ${p.facts.length} 条`);
        console.log(`  目标: ${p.goals.length} 个`);
        console.log(`  习惯: ${p.habits.length} 条`);
        console.log(`  情绪记录: ${p.emotionalHistory.length} 条`);
        const history = runtime.getHistory();
        console.log(`  本轮对话: ${history.length} 条消息`);
        console.log();
        break;
      }

      case cmd.startsWith("/remember "): {
        const info = cmd.slice(10);
        cola.learnAboutUser(info, "fact");
        console.log(`🧠 已记住: ${info}\n`);
        break;
      }

      case cmd.startsWith("/search "): {
        const query = cmd.slice(8);
        const results = cola.searchMemories(query);
        console.log(`\n🔍 搜索 "${query}"`);
        if (results.length === 0) {
          console.log("  没有找到相关记忆");
        } else {
          for (const m of results) {
            console.log(`  [${m.type}] ${m.summary || m.content.slice(0, 100)}`);
          }
        }
        console.log();
        break;
      }

      case cmd === "/dreams": {
        const dreams = cola.getRecentDreams(5);
        console.log(`\n📓 最近梦境`);
        for (const d of dreams) {
          console.log(`  ${d.date}: ${d.keyTopics.slice(0, 3).join(", ")}`);
        }
        console.log();
        break;
      }

      default: {
        try {
          const reply = await runtime.chat(cmd);
          const name = cola.getCoreIdentity().name;
          console.log(`\n  ${name} > ${reply}\n`);
        } catch (err: any) {
          console.error(`\n❌ ${err.message || err}\n`);
        }
        break;
      }
    }
  }

  readline.close();
  cola.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});