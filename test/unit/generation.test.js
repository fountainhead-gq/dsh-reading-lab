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
    assert.equal(record.timeoutMs, 180_000)
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

  it('UT-GEN-04 agent/error → failed，reason 与 message 同时进状态、SSE 与日志', () => {
    const { tracker, events, logs } = makeTracker()
    tracker.begin('b0123456789ab', { agentId: 'agent-main' })
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

  it('UT-GEN-08 看门狗：未认领与已认领给出不同提示；超时后闸门释放', async () => {
    const first = makeTracker({ timeoutMs: 20 })
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

    const second = makeTracker({ timeoutMs: 20 })
    second.tracker.begin('b0123456789ab', { agentId: 'agent-main' })
    second.tracker.attachPrompt('b0123456789ab', { promptId: 'p-1' })
    second.tracker.handle('agent/inbox/claimed', { message: { id: 'p-1' } })
    await sleep(60)
    const runningTimeout = second.tracker.snapshot('b0123456789ab')
    assert.equal(runningTimeout.state, 'failed')
    assert.match(runningTimeout.message, /没有提交导图/)
    second.tracker.close()
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