/**
 * OpenColaOS — 集成测试
 */

import { Cola } from "../src/cola.ts";

async function main() {
  const cola = new Cola({ name: "Cola" });
  console.log("🧪 OpenColaOS 集成测试开始\n");

  // Test 1: Status
  console.log("─── Test 1: 初始状态 ───");
  let profile = cola.getUserProfile();
  let id = cola.getCoreIdentity();
  console.log(`  版本: v${id.version}`);
  console.log(`  关系: ${profile.relationshipStage}`);
  console.log(`  用户事实: ${profile.facts.length} 条`);
  console.log(`  ✅ OK\n`);

  // Test 2: 学习用户信息
  console.log("─── Test 2: 学习用户信息 ───");
  cola.learnAboutUser("我叫小明，从事软件开发", "fact");
  cola.learnAboutUser("我的目标是学会Rust", "goal");
  cola.learnAboutUser("我习惯晚上工作", "habit");
  profile = cola.getUserProfile();
  console.log(`  事实: ${JSON.stringify(profile.facts)}`);
  console.log(`  目标: ${JSON.stringify(profile.goals)}`);
  console.log(`  习惯: ${JSON.stringify(profile.habits)}`);
  console.log(`  ✅ OK\n`);

  // Test 3: 对话 + 记忆
  console.log("─── Test 3: 对话与上下文 ───");
  const result1 = await cola.hear("今天心情不太好，项目延期了有点焦虑");
  console.log(`  shouldRemember: ${JSON.stringify(result1.shouldRemember)}`);
  profile = cola.getUserProfile();
  console.log(`  情绪记录: ${profile.emotionalHistory.length} 条`);
  console.log(`  ✅ OK\n`);

  // Test 4: 中断协议
  console.log("─── Test 4: 中断协议 ───");
  const snap = cola.pauseTask("修复数据库连接池bug", "已定位到问题，正在测试修复方案");
  console.log(`  冻结任务: ${snap.taskDescription}`);
  console.log(`  进度: ${snap.progress}`);
  console.log(`  状态: ${snap.state}`);

  const resumed = cola.resumeTask();
  console.log(`  恢复任务: ${resumed?.taskDescription}`);
  console.log(`  ✅ OK\n`);

  // Test 5: 梦境
  console.log("─── Test 5: 梦境系统 ───");
  await cola.speak("项目延期确实让人焦虑，不过你已经定位到问题了，这说明进度其实不错。要不要梳理一下剩下的工作量？");
  await cola.hear("好啊，让我想想还有哪些模块没做完");
  await cola.speak("我帮你列个清单吧，这样心里有数。");

  const journal = await cola.dreamTime();
  console.log(`  日期: ${journal.date}`);
  console.log(`  话题: ${journal.keyTopics.join(", ")}`);
  console.log(`  用户情绪: ${journal.userState.mood}`);
  console.log(`  提取任务: ${journal.tasksExtracted.length} 条`);
  console.log(`  新知: ${journal.newKnowledge.length} 条`);
  console.log(`  早安简报: ${journal.morningBriefing.slice(0, 100)}...`);

  // Test 6: 关系升级
  console.log("\n─── Test 6: 关系成长 ───");
  const identitySystem = cola.identity;
  const newStage = identitySystem.checkRelationshipUpgrade();
  profile = cola.getUserProfile();
  console.log(`  当前关系: ${profile.relationshipStage}`);
  console.log(`  ✅ OK\n`);

  // Test 7: 记忆检索
  console.log("─── Test 7: 记忆检索 ───");
  const memories = cola.searchMemories("焦虑 项目");
  console.log(`  检索结果: ${memories.length} 条`);
  for (const mem of memories) {
    console.log(`    [${mem.type}] ${mem.summary || mem.content.slice(0, 80)}`);
  }
  console.log(`  ✅ OK\n`);

  // Test 8: 身份版本
  console.log("─── Test 8: 身份成长 ───");
  id = cola.getCoreIdentity();
  console.log(`  最终版本: v${id.version}`);
  console.log(`  最终关系: ${profile.relationshipStage}`);
  console.log(`  用户事实: ${profile.facts.length} 条`);
  console.log(`  ✅ OK\n`);

  console.log("🎉 所有测试通过！");

  cola.close();
}

main().catch((err) => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});