/**
 * OpenColaOS — 中断协议
 *
 * 当用户切换任务时：Freeze → Switch → Resume
 * 自动 checkpoint 当前任务，恢复时重建上下文
 */

import { TaskSnapshot } from "../types/index.ts";
import { MemoryStore } from "../memory/store.ts";
import { ContextManager } from "../context/manager.ts";

export class InterruptProtocol {
  constructor(
    private store: MemoryStore,
    private context: ContextManager,
  ) {}

  /**
   * Step 1: FREEZE
   * 用户中断当前任务去做别的，快照当前状态
   */
  freeze(taskDescription: string, progress: string): TaskSnapshot {
    const snapshot = this.store.saveTaskSnapshot({
      taskDescription,
      progress,
      contextSummary: this.context.getWorkingMemoryText().slice(-1000),
      timestamp: Date.now(),
      relatedFiles: [],
      state: "frozen",
    });

    // 保存为 working memory checkpoint
    this.context.addMessage("system",
      `[任务暂停] "${taskDescription}" — 进度：${progress}`
    );

    console.log(`⏸️ 已冻结任务: "${taskDescription}"`);
    return snapshot;
  }

  /**
   * Step 2: SWITCH
   * 清空工作记忆，准备处理新任务
   */
  switch(): void {
    this.context.clearWorkingMemory();
    this.context.addMessage("system", "[上下文已切换，开始新任务]");
    console.log("🔄 上下文已切换，准备处理新任务");
  }

  /**
   * Step 3: RESUME
   * 恢复之前冻结的任务
   */
  resume(snapshotId?: string): TaskSnapshot | null {
    const snapshot = snapshotId
      ? this.store.getActiveTaskSnapshot()  // 简化：应该按 ID 查
      : this.store.getActiveTaskSnapshot();

    if (!snapshot) {
      console.log("⚠️ 没有找到冻结的任务");
      return null;
    }

    // 从 checkpoint 恢复上下文
    this.context.clearWorkingMemory();
    this.context.addMessage("system",
      `[恢复任务] "${snapshot.taskDescription}"\n之前进度：${snapshot.progress}\n上下文：${snapshot.contextSummary}`
    );

    // 更新状态
    this.store.updateTaskSnapshotState(snapshot.id, "active");

    console.log(`▶️ 已恢复任务: "${snapshot.taskDescription}"`);
    return snapshot;
  }

  /**
   * 完成当前任务
   */
  complete(snapshotId: string): void {
    this.store.updateTaskSnapshotState(snapshotId, "completed");
    this.context.addMessage("system", "[当前任务已完成]");
    console.log("✅ 任务标记为完成");
  }

  /**
   * 丢弃任务（不保留）
   */
  discard(snapshotId: string): void {
    this.store.updateTaskSnapshotState(snapshotId, "discarded");
    console.log("🗑️ 任务已丢弃");
  }

  /**
   * 查看所有冻结的任务
   */
  listFrozen(): TaskSnapshot[] {
    return this.store.getAllSnapshotsByState("frozen");
  }
}