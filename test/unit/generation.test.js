/**
 * UT-GEN-01..08：生成请求状态机（t29 / QA-11-07）。
 *
 * 这些用例只碰 `generation.js`：注入 publish/log，用可控时钟与小超时，
 * 覆盖 pending → running → done/failed、事件对齐与看门狗。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ReadingError } from '../../src/host/errors.js'
import { GenerationTracker } from '../../src/host/generation.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeTracker(options = {}) {
  const events = []
  const logs = []
  const tracker = new GenerationTracker({
    publish: (event) => events.push(event),
    log: { warn: (line) => logs.push(line) },
    ...options,
  })
  return { tracker, events, logs }
}

describe('generation tracker', () => {
  it('UT-GEN-01 begin 产生 pending 记录，字段与文档一致', () => {
    const { tracker, events } = makeTracker({ now: () => 1_000 })
    const record = tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    assert.equal(record.state, 'pending')
    assert.equal(record.agentId, 'agent-main')
    assert.equal(record.promptId, null)
    assert.equal(record.startedAt, new Date(1_000).toISOString())
    assert.equal(record.timeoutMs, 60_000)
    // t34：三段预算同时进快照，面板据此画「还在跑」而不是固定倒计时。
    assert.deepEqual(record.budget, {
      queueTimeoutMs: 60_000,
      idleTimeoutMs: 180_000,
      maxDurationMs: 1_800_000,
    })
    assert.equal(record.claimedAt, null)
    // begin 本身就是一次活动：空闲计时从此刻起算。
    assert.equal(record.lastActivityAt, new Date(1_000).toISOString())
    assert.equal(record.lastActivityKind, 'begin')
    assert.equal(record.idleMs, 0)
    assert.equal(record.elapsedMs, 0)
    assert.equal(tracker.isGenerating('b0123456789ab'), true)
    assert.equal(events[0].type, 'progress')
    assert.equal(events[0].phase, 'mapping')
    tracker.close()
  })

  it('UT-GEN-02 未完成时再次 begin 抛 E_BUSY，带 state/agentId', () => {
    const { tracker } = makeTracker()
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    assert.throws(
      () => tracker.begin('b0123456789ab'),
      (error) => {
        assert.ok(error instanceof ReadingError)
        assert.equal(error.code, 'E_BUSY')
        assert.equal(error.details.reason, 'mapping')
        assert.equal(error.details.state, 'pending')
        return true
      },
    )
    tracker.close()
  })

  it('UT-GEN-03 只认领 promptId 匹配的消息；无关消息不影响状态', () => {
    const { tracker } = makeTracker()
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    tracker.attachPrompt('b0123456789ab', { promptId: 'p-1' })

    assert.deepEqual(tracker.handle('agent/inbox/claimed', { message: { id: 'other' } }), [])
    assert.equal(tracker.snapshot('b0123456789ab').state, 'pending')

    const affected = tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })
    assert.equal(affected.length, 1)
    assert.equal(affected[0].state, 'running')
    assert.ok(affected[0].claimedAt)
    tracker.close()
  })

  it('UT-GEN-04 agent/error 归因到已认领的记录 → failed，reason 与 message 同时进状态、SSE 与日志', () => {
    const { tracker, events, logs } = makeTracker()
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    tracker.attachPrompt('b0123456789ab', { promptId: 'p-1' })
    tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })
    tracker.handle('agent/error', {
      agent: { id: 'agent-main' },
      error: new Error('agent "agent-main" has no provider/model: none'),
    })

    const record = tracker.snapshot('b0123456789ab')
    assert.equal(record.state, 'failed')
    assert.equal(record.reason, 'agent-error')
    assert.match(record.message, /no provider\/model/)
    assert.ok(record.finishedAt)

    const failedEvent = events.find((event) => event.phase === 'failed')
    assert.equal(failedEvent.reason, 'agent-error')
    assert.equal(failedEvent.bookId, 'b0123456789ab')
    assert.equal(logs.length, 1)
    assert.match(logs[0], /导图生成失败.*agent-error/)
    tracker.close()
  })

  it('UT-GEN-05 别的 agent 的报错不误伤本请求', () => {
    const { tracker } = makeTracker()
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    tracker.handle('agent/error', { agent: { id: 'agent-other' }, error: new Error('boom') })
    assert.equal(tracker.snapshot('b0123456789ab').state, 'pending')
    tracker.close()
  })

  it('UT-GEN-06 已认领后回合结束（status 非 running）→ turn-ended；未认领不误判', () => {
    const { tracker } = makeTracker()
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    tracker.attachPrompt('b0123456789ab', { promptId: 'p-1' })

    // 还没认领：agent 在跑别的回合，不能算我们的失败。
    tracker.handle('agent/status', { agent: { id: 'agent-main' }, status: 'idle' })
    assert.equal(tracker.snapshot('b0123456789ab').state, 'pending')

    tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })
    tracker.handle('agent/status', { agent: { id: 'agent-main' }, status: 'idle' })
    const record = tracker.snapshot('b0123456789ab')
    assert.equal(record.state, 'failed')
    assert.equal(record.reason, 'turn-ended')
    tracker.close()
  })

  it('UT-GEN-07 消息被丢弃 → inbox-discarded，带丢弃原因', () => {
    const { tracker } = makeTracker()
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    tracker.attachPrompt('b0123456789ab', { promptId: 'p-1' })
    tracker.handle('agent/inbox/discarded', { message: { id: 'p-1' }, reason: 'turn-cancelled' })
    const record = tracker.snapshot('b0123456789ab')
    assert.equal(record.state, 'failed')
    assert.equal(record.reason, 'inbox-discarded')
    assert.equal(record.message, 'turn-cancelled')
    tracker.close()
  })

  it('UT-GEN-08 看门狗：排队超时与认领后空闲超时给出不同提示；超时后闸门释放', async () => {
    const first = makeTracker({ queueTimeoutMs: 20, idleTimeoutMs: 20 })
    first.tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    await sleep(60)
    const pendingTimeout = first.tracker.snapshot('b0123456789ab')
    assert.equal(pendingTimeout.state, 'failed')
    assert.equal(pendingTimeout.reason, 'timeout')
    assert.match(pendingTimeout.message, /没有被 agent 认领/)
    assert.equal(first.tracker.isGenerating('b0123456789ab'), false)
    // 超时后可重新发起，不再 409。
    first.tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    assert.equal(first.tracker.snapshot('b0123456789ab').state, 'pending')
    first.tracker.close()

    const second = makeTracker({ queueTimeoutMs: 20, idleTimeoutMs: 20 })
    second.tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    second.tracker.attachPrompt('b0123456789ab', { promptId: 'p-1' })
    second.tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })
    await sleep(60)
    const runningTimeout = second.tracker.snapshot('b0123456789ab')
    assert.equal(runningTimeout.state, 'failed')
    assert.match(runningTimeout.message, /没有新的活动/)
    assert.match(runningTimeout.message, /最近活动：inbox-claimed/)
    second.tracker.close()
  })

  it('UT-GEN-11 claimedAt 由认领事件置位；agent/status running 也能作为认领证据', () => {
    const viaClaim = makeTracker({ now: () => 1_000 })
    viaClaim.tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    viaClaim.tracker.attachPrompt('b0123456789ab', { promptId: 'p-1' })
    const claimed = viaClaim.tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })
    assert.equal(claimed[0].claimedAt, new Date(1_000).toISOString())
    assert.equal(claimed[0].claimEvidence, 'inbox-claimed')
    assert.equal(claimed[0].lastActivityAt, new Date(1_000).toISOString())
    viaClaim.tracker.close()

    const viaStatus = makeTracker({ now: () => 2_000 })
    viaStatus.tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    const running = viaStatus.tracker.handle('agent/status', { agent: { id: 'agent-main' }, status: 'running' })
    assert.equal(running[0].state, 'running')
    assert.equal(running[0].claimedAt, new Date(2_000).toISOString())
    assert.equal(running[0].claimEvidence, 'agent-status')
    viaStatus.tracker.close()
  })

  it('UT-GEN-12 认领后持续活动：跨过 idle 窗口仍 running，最后 done', async () => {
    let now = 0
    const { tracker, events } = makeTracker({
      now: () => now,
      queueTimeoutMs: 1_000,
      idleTimeoutMs: 40,
      maxDurationMs: 10_000,
    })
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    tracker.attachPrompt('b0123456789ab', { promptId: 'p-1' })
    tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })

    // 认领后每 25ms 有一次工具活动，累计超过旧实现 180s 的固定预算。
    for (let index = 0; index < 4; index += 1) {
      await sleep(25)
      now += 25
      tracker.noteActivity('b0123456789ab', 'tool:chunks')
    }
    assert.equal(tracker.snapshot('b0123456789ab').state, 'running')
    assert.equal(tracker.snapshot('b0123456789ab').lastActivityKind, 'tool:chunks')

    tracker.complete('b0123456789ab')
    const record = tracker.snapshot('b0123456789ab')
    assert.equal(record.state, 'done')
    assert.equal(events.filter((event) => event.phase === 'failed').length, 0)
    tracker.close()
  })

  it('UT-GEN-13 绝对上限：持续活动也会在 maxDuration 处失败，message 带已用时长', async () => {
    // 真实时钟：活动不断重置空闲计时，只有绝对上限能收尾。
    const { tracker } = makeTracker({
      queueTimeoutMs: 40,
      idleTimeoutMs: 40,
      maxDurationMs: 90,
    })
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    tracker.attachPrompt('b0123456789ab', { promptId: 'p-1' })
    tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })

    for (let index = 0; index < 6; index += 1) {
      await sleep(20)
      tracker.noteActivity('b0123456789ab', 'tool:outline')
    }
    await sleep(10)
    const record = tracker.snapshot('b0123456789ab')
    assert.equal(record.state, 'failed')
    assert.equal(record.reason, 'timeout')
    assert.match(record.message, /超过绝对上限/)
    tracker.close()
  })

  it('UT-GEN-14 只有活动、没有认领：claimedAt 保持 null，但状态推进到 running', () => {
    let now = 0
    const { tracker } = makeTracker({ now: () => now })
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    now = 5_000
    const record = tracker.noteActivity('b0123456789ab', 'tool:chunks')
    assert.equal(record.state, 'running')
    assert.equal(record.claimedAt, null)
    assert.equal(record.claimEvidence, 'tool-activity')
    assert.equal(record.lastActivityAt, new Date(5_000).toISOString())
    assert.equal(record.idleMs, 0)
    tracker.close()
  })

  it('UT-GEN-15 阶段截止（QA-35-01）：认领后 0s 的提前回调保持 running，到空闲窗口才失败', () => {
    let now = 0
    const { tracker } = makeTracker({
      now: () => now,
      queueTimeoutMs: 1_000,
      idleTimeoutMs: 5_000,
      maxDurationMs: 60_000,
    })
    const bookId = 'b0123456789ab'
    tracker.begin(bookId, { agentId: 'agent-main' })
    tracker.attachPrompt(bookId, { promptId: 'p-1' })
    tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })

    // 与认领同刻的重复/提前回调：空闲窗口还没到期，不能判超时。
    assert.equal(tracker.onWatchdog(bookId, tracker.timers.get(bookId)), true)
    assert.equal(tracker.snapshot(bookId).state, 'running')
    assert.equal(tracker.timers.size, 1, '提前回调后必须重新武装看门狗')

    // 排队预算 1000ms 已经过了也不能算排队超时：记录已进入 running。
    now = 1_500
    tracker.onWatchdog(bookId, tracker.timers.get(bookId))
    assert.equal(tracker.snapshot(bookId).state, 'running')

    // 空闲窗口真的到期（0 + 5000）才失败。
    now = 6_000
    tracker.onWatchdog(bookId, tracker.timers.get(bookId))
    const record = tracker.snapshot(bookId)
    assert.equal(record.state, 'failed')
    assert.match(record.message, /没有新的活动/)
    tracker.close()
  })

  it('UT-GEN-16 定时器代际（QA-35-01）：过期回调不消费、不删除新定时器', () => {
    const { tracker } = makeTracker({ now: () => 1_000 })
    const bookId = 'b0123456789ab'
    tracker.begin(bookId, { agentId: 'agent-main' })
    const stale = tracker.timers.get(bookId)

    tracker.noteActivity(bookId, 'tool:chunks')
    const fresh = tracker.timers.get(bookId)
    assert.notEqual(fresh, stale, '活动之后必须换一支新定时器')

    assert.equal(tracker.onWatchdog(bookId, stale), false)
    assert.equal(tracker.timers.get(bookId), fresh, '旧回调不能删掉新定时器')
    assert.equal(tracker.snapshot(bookId).state, 'running')
    tracker.close()
  })

  it('UT-GEN-17 跨记录归因隔离（QA-35-02）：b1 的报错不失败 b2 的排队记录', () => {
    const { tracker } = makeTracker({ now: () => 1_000 })
    const book1 = 'b000000000001'
    const book2 = 'b000000000002'
    tracker.begin(book1, { agentId: 'agent-main' })
    tracker.attachPrompt(book1, { promptId: 'p-1' })
    tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })
    tracker.begin(book2, { agentId: 'agent-main' })
    tracker.attachPrompt(book2, { promptId: 'p-2' })

    // 事件带 turn.messageId：只归因到 b1。
    const affected = tracker.handle('agent/error', {
      agent: { id: 'agent-main' },
      turn: { messageId: 'p-1' },
      error: new Error('boom'),
    })
    assert.equal(affected.length, 1)
    assert.equal(tracker.snapshot(book1).state, 'failed')
    assert.equal(tracker.snapshot(book1).reason, 'agent-error')
    assert.equal(tracker.snapshot(book2).state, 'pending', 'b2 的排队记录不能被 b1 的错误带走')
    tracker.close()
  })

  it('UT-GEN-18 无法归因时不批量失败（QA-35-02）：两条 running 无 message id → 都保持 running', () => {
    const { tracker, logs } = makeTracker({ now: () => 1_000 })
    const book1 = 'b000000000001'
    const book2 = 'b000000000002'
    for (const [bookId, promptId] of [[book1, 'p-1'], [book2, 'p-2']]) {
      tracker.begin(bookId, { agentId: 'agent-main' })
      tracker.attachPrompt(bookId, { promptId })
      tracker.handle('agent/inbox/claimed', { message: { id: promptId } })
    }

    assert.deepEqual(tracker.handle('agent/error', { agent: { id: 'agent-main' }, error: new Error('boom') }), [])
    assert.equal(tracker.snapshot(book1).state, 'running')
    assert.equal(tracker.snapshot(book2).state, 'running')
    assert.ok(logs.length === 0, '无法归因只写 info，不算失败日志')

    // agent/status running 同样不能把别的排队记录伪造成 running。
    const book3 = 'b000000000003'
    tracker.begin(book3, { agentId: 'agent-main' })
    tracker.handle('agent/status', { agent: { id: 'agent-main' }, status: 'running' })
    assert.equal(tracker.snapshot(book3).state, 'pending', '多条候选时 status 不能猜')
    tracker.close()
  })

  it('UT-GEN-19 agent/status running 带 message id 时只推进对应记录（QA-35-02）', () => {
    const { tracker } = makeTracker({ now: () => 1_000 })
    const book1 = 'b000000000001'
    const book2 = 'b000000000002'
    tracker.begin(book1, { agentId: 'agent-main' })
    tracker.attachPrompt(book1, { promptId: 'p-1' })
    tracker.begin(book2, { agentId: 'agent-main' })
    tracker.attachPrompt(book2, { promptId: 'p-2' })

    const affected = tracker.handle('agent/status', {
      agent: { id: 'agent-main' },
      status: 'running',
      turn: { messageId: 'p-2' },
    })
    assert.equal(affected.length, 1)
    assert.equal(tracker.snapshot(book2).state, 'running')
    assert.equal(tracker.snapshot(book2).claimEvidence, 'agent-status')
    assert.equal(tracker.snapshot(book1).state, 'pending')
    assert.equal(tracker.snapshot(book1).claimedAt, null)
    tracker.close()
  })

  it('UT-GEN-09 close 把未完成请求置 failed，并清理定时器', () => {
    const { tracker } = makeTracker({ timeoutMs: 60_000 })
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    tracker.close()
    const record = tracker.snapshot('b0123456789ab')
    assert.equal(record.state, 'failed')
    assert.equal(record.reason, 'agent-disposed')
    assert.equal(tracker.timers.size, 0)
  })

  it('UT-GEN-10 终态记录在 recordTtlMs 之后被清理；done 不接受后续失败', () => {
    let now = 1_000
    const { tracker } = makeTracker({ now: () => now, recordTtlMs: 500 })
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    tracker.complete('b0123456789ab')
    assert.equal(tracker.snapshot('b0123456789ab').state, 'done')
    // done 是终态：迟到的 error 不能把它改成 failed。
    tracker.handle('agent/error', { agent: { id: 'agent-main' }, error: new Error('late') })
    assert.equal(tracker.snapshot('b0123456789ab').state, 'done')

    now += 1_000
    assert.equal(tracker.active('b0123456789ab'), null)
    assert.equal(tracker.snapshot('b0123456789ab').state, 'idle')
    tracker.close()
  })
})