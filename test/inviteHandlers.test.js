import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-handlers-'))
const runtimePlugin = path.join(runtimeRoot, 'plugins', 'auto-leave-plugin')
fs.mkdirSync(path.join(runtimePlugin, 'apps'), { recursive: true })
fs.mkdirSync(path.join(runtimeRoot, 'lib', 'plugins'), { recursive: true })
fs.writeFileSync(path.join(runtimeRoot, 'package.json'), JSON.stringify({ type: 'module' }))
fs.writeFileSync(path.join(runtimeRoot, 'lib', 'plugins', 'plugin.js'), 'export default class plugin { constructor(options) { Object.assign(this, options) } }')
fs.copyFileSync(path.join(pluginRoot, 'apps', 'inviteManagement.js'), path.join(runtimePlugin, 'apps', 'inviteManagement.js'))
for (const directory of ['components', 'model', 'utils']) {
  fs.symlinkSync(path.join(pluginRoot, directory), path.join(runtimePlugin, directory), 'junction')
}
process.chdir(runtimeRoot)
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }

const { Config } = await import('../components/config.js')
const { InviteManagementService } = await import('../model/inviteManagement.js')
const { BotInviteConfirmHandler, BotInviteRequestHandler } = await import(pathToFileURL(path.join(runtimePlugin, 'apps', 'inviteManagement.js')).href)

const calls = []
const events = new EventEmitter()
const bot = {
  self_id: '10001',
  cfg: { master: [] },
  on: events.on.bind(events),
  gl: new Map([[111111, { group_name: '已有群', member_count: 20 }]]),
  async sendApi(action, params) {
    calls.push({ action, params })
    if (action === 'get_msg') {
      const text = params.message_id === 333
        ? '群号：222222\n请求ID：10001-expired-222222'
        : '群号：111111\n请求ID：10001-stay-111111'
      return { data: { message: [{ type: 'text', data: { text } }] } }
    }
    if (action === 'set_group_add_request') return { status: 'ok', retcode: 0 }
    if (action === 'send_private_msg') return { status: 'ok', retcode: 0 }
    if (action === 'get_stranger_info') return { data: { nickname: '邀请人' } }
    if (action === 'get_group_info') return { data: { group_id: 222222, member_count: 0 } }
    if (action === 'get_group_detail_info') return { data: { groupCode: '222222', memberNum: 56 } }
    throw new Error(`unexpected action: ${action}`)
  },
  async sendGroupMsg(groupId, message) {
    calls.push({ action: 'notify', groupId, message })
    return { message_id: 444 }
  },
  async setGroupLeave(groupId) { calls.push({ action: 'leave', groupId }) }
}
globalThis.Bot = bot

function resetConfig() {
  const config = Config.loadConfig()
  config.inviteManagement.enabled = true
  config.inviteManagement.notifyGroups = []
  config.inviteManagement.notifyUsers = []
  config.inviteManagement.pendingRequests = []
  config.inviteManagement.stayReviews = []
  config.inviteManagement.stayReviewCooldowns = []
  config.inviteManagement.pendingJoins = []
  config.inviteManagement.approvedGroupStates = []
  config.inviteManagement.blackGroups = []
  config.inviteManagement.whiteGroups = []
  config.inviteManagement.reviewMode = 2
  config.notification.enabled = false
  Config.saveConfig(config)
  bot.gl = new Map([[111111, { group_name: '已有群', member_count: 20 }]])
  calls.length = 0
}

function addStayReview() {
  const service = new InviteManagementService({ bot })
  service.saveStayReview({
    requestId: '10001-stay-111111',
    botId: '10001',
    groupId: '111111',
    groupName: '已有群',
    memberCount: 20,
    requestTime: Date.now(),
    expiresAt: Date.now() + 60000,
    status: 'pending',
    msgIds: ['111'],
    manageGroupIds: ['777777']
  })
}

function addInvite() {
  new InviteManagementService({ bot }).addPendingRequest({
    requestId: '10001-invite-222222',
    botId: '10001',
    groupId: '222222',
    groupName: '邀请群',
    userId: '30003',
    flag: 'invite-flag',
    requestTime: Date.now(),
    msgIds: ['222'],
    manageGroupIds: ['777777']
  })
}

function command(raw, text, options = {}) {
  const replies = []
  return {
    event: {
      bot,
      self_id: bot.self_id,
      user_id: 30003,
      group_id: 777777,
      isMaster: true,
      raw_message: raw,
      msg: text,
      message: [{ type: 'reply', id: 111 }, { type: 'text', text }],
      async reply(message) { replies.push(message) },
      ...options
    },
    replies
  }
}

test('quoted confirmation approves the referenced stay review without leaving', async () => {
  resetConfig()
  addStayReview()
  const { event, replies } = command('[CQ:reply,id=111]t确认加群', 't确认加群')
  await new BotInviteConfirmHandler().handleConfirm(event)
  assert.match(replies[0], /已批准机器人留群/)
  assert.equal(calls.some(call => call.action === 'leave'), false)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
})

test('mixed message segments cannot turn a confirmation into a rejection', async () => {
  resetConfig()
  addStayReview()
  const { event, replies } = command('[CQ:reply,id=111][CQ:at,qq=10001]t确认加群[CQ:face,id=123]',
    '{"title":"t拒绝加群","id":7654321}t确认加群', {
      message: [
        { type: 'reply', data: { id: 111 } },
        { type: 'at', data: { qq: '10001' } },
        { type: 'face', data: { id: '123' } },
        { type: 'json', data: '{"title":"t拒绝加群","id":7654321}' },
        { type: 'text', data: { text: 't确认加群' } }
      ]
    })
  const handler = new BotInviteConfirmHandler()
  const rule = handler.rule.find(item => item.reg.test(event.msg))
  assert.ok(rule)
  await handler[rule.fnc](event)
  assert.match(replies[0], /已批准机器人留群/)
  assert.equal(calls.some(call => call.action === 'leave'), false)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
})

test('Unicode emoji around an approval remain an approval', async () => {
  resetConfig()
  addStayReview()
  const { event, replies } = command('[CQ:reply,id=111]😊t确认加群👍', '😊t确认加群👍', {
    message: [{ type: 'reply', id: 111 }, { type: 'text', text: '😊t确认加群👍' }]
  })
  const handler = new BotInviteConfirmHandler()
  const rule = handler.rule.find(item => item.reg.test(event.msg))
  assert.ok(rule)
  await handler[rule.fnc](event)
  assert.match(replies[0], /已批准机器人留群/)
  assert.equal(calls.some(call => call.action === 'leave'), false)
})

test('emoji between digits cannot merge a different group number', async () => {
  resetConfig()
  addStayReview()
  const { event } = command('t确认加群 111😊111', 't确认加群 111😊111', {
    message: [{ type: 'text', text: 't确认加群 111😊111' }]
  })
  const handler = new BotInviteConfirmHandler()
  const rule = handler.rule.find(item => item.reg.test(event.msg))
  if (rule) assert.equal(await handler[rule.fnc](event), false)
  assert.equal(calls.some(call => call.action === 'leave'), false)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 1)
})

test('a rejection remains a rejection when card metadata contains an approval', async () => {
  resetConfig()
  addInvite()
  const { event, replies } = command('[CQ:reply,id=222]t拒绝加群',
    't拒绝加群{"title":"t确认加群"}', {
      message: [
        { type: 'reply', id: 222 },
        { type: 'text', text: 't拒绝加群' },
        { type: 'json', data: '{"title":"t确认加群"}' }
      ]
    })
  const handler = new BotInviteConfirmHandler()
  const rule = handler.rule.find(item => item.reg.test(event.msg))
  assert.ok(rule)
  await handler[rule.fnc](event)
  assert.match(replies[0], /加群请求已拒绝/)
  assert.equal(calls.find(call => call.action === 'set_group_add_request')?.params.approve, false)
})

test('a command contained only in a card cannot authorize an action', async () => {
  resetConfig()
  addStayReview()
  const { event } = command('[CQ:reply,id=111][CQ:json,data=...]', '{"title":"t拒绝加群"}', {
    message: [{ type: 'reply', id: 111 }, { type: 'json', data: '{"title":"t拒绝加群"}' }]
  })
  const handler = new BotInviteConfirmHandler()
  const rule = handler.rule.find(item => item.reg.test(event.msg))
  if (rule) assert.equal(await handler[rule.fnc](event), false)
  assert.equal(calls.some(call => call.action === 'leave'), false)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 1)
})

test('an explicit group target cannot be overridden by an unrelated quoted review', async () => {
  resetConfig()
  addStayReview()
  addInvite()
  const { event, replies } = command('[CQ:reply,id=111]t确认加群 222222', 't确认加群 222222')
  await new BotInviteConfirmHandler().handleConfirm(event)
  assert.match(replies[0], /加群请求已同意/)
  assert.equal(calls.find(call => call.action === 'set_group_add_request')?.params.flag, 'invite-flag')
  assert.equal(calls.some(call => call.action === 'leave'), false)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 1)
})

test('an unrecognised command never becomes a rejection', async () => {
  resetConfig()
  addStayReview()
  const { event } = command('[CQ:reply,id=111]无效命令', '无效命令')
  await new BotInviteConfirmHandler().handleConfirm(event)
  assert.equal(calls.some(call => call.action === 'leave'), false)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 1)
})

test('quoted force approval still requires master permission', async () => {
  resetConfig()
  addStayReview()
  const { event, replies } = command('[CQ:reply,id=111]t强制同意加群', 't强制同意加群', { isMaster: false, sender: { role: 'admin' } })
  await new BotInviteConfirmHandler().handleConfirm(event)
  assert.equal(replies[0], '只有主人才能强制同意群邀请')
  assert.equal(calls.some(call => call.action === 'leave'), false)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 1)
})

test('a raw-only quoted confirmation remains an approval', async () => {
  resetConfig()
  addStayReview()
  const { event, replies } = command('[CQ:reply,id=111]t确认加群', '', { msg: undefined, message: undefined })
  await new BotInviteConfirmHandler().handleConfirm(event)
  assert.match(replies[0], /已批准机器人留群/)
  assert.equal(calls.some(call => call.action === 'leave'), false)
})

test('a quoted expired invitation cannot act on a different stay review', async () => {
  resetConfig()
  addStayReview()
  const { event, replies } = command('[CQ:reply,id=333]t确认加群', 't确认加群', {
    message: [{ type: 'reply', id: 333 }, { type: 'text', text: 't确认加群' }]
  })
  await new BotInviteConfirmHandler().handleConfirm(event)
  assert.match(replies[0], /未找到对应的加群请求/)
  assert.equal(calls.some(call => call.action === 'leave'), false)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 1)
})

test('an expired quoted force approval does not create a future exemption', async () => {
  resetConfig()
  const { event, replies } = command('[CQ:reply,id=333]t强制同意加群', 't强制同意加群', {
    message: [{ type: 'reply', id: 333 }, { type: 'text', text: 't强制同意加群' }]
  })
  await new BotInviteConfirmHandler().handleConfirm(event)
  assert.match(replies[0], /未找到对应的加群请求/)
  assert.equal(new InviteManagementService({ bot }).isApprovedGroup('222222'), false)
})

test('an explicit rejection rejects the intended invitation', async () => {
  resetConfig()
  addInvite()
  const { event, replies } = command('[CQ:reply,id=111]t拒绝加群 222222', 't拒绝加群 222222')
  await new BotInviteConfirmHandler().handleConfirm(event)
  assert.match(replies[0], /加群请求已拒绝/)
  assert.equal(calls.find(call => call.action === 'set_group_add_request')?.params.approve, false)
})

test('a failed protocol response leaves the invitation pending', async () => {
  resetConfig()
  addInvite()
  const sendApi = bot.sendApi
  bot.sendApi = async (action, params) => action === 'set_group_add_request'
    ? { status: 'failed', retcode: 100, message: '邀请已失效' }
    : sendApi.call(bot, action, params)
  try {
    const { event, replies } = command('t确认加群 222222', 't确认加群 222222', { message: [{ type: 'text', text: 't确认加群 222222' }] })
    await new BotInviteConfirmHandler().handleConfirm(event)
    assert.match(replies[0], /处理失败/)
    assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 1)
    assert.equal(new InviteManagementService({ bot }).isApprovedGroup('222222'), false)
  } finally {
    bot.sendApi = sendApi
  }
})

test('private card metadata reaches the matching invitation review notice', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.minMemberCount = 50
  config.inviteManagement.reviewMode = 2
  config.inviteManagement.notifyGroups = [777777]
  Config.saveConfig(config)
  const { initEventListener } = await import('../model/index.js')
  assert.equal(initEventListener(), true)
  const card = {
    bizsrc: 'qun.invite',
    meta: { news: { jumpUrl: 'mqqapi://group/invite_join?groupcode=222222&groupname=%E6%B5%8B%E8%AF%95%E7%BE%A4&receiveruin=10001' } }
  }
  events.emit('message.private', {
    self_id: '10001',
    user_id: '30003',
    message_type: 'private',
    message: [{ type: 'json', data: JSON.stringify(card) }]
  })
  assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
  assert.equal(calls.some(call => call.action === 'set_group_add_request'), false)
  await new BotInviteRequestHandler().accept({
    bot,
    self_id: '10001',
    user_id: '30003',
    group_id: '222222',
    flag: 'card-request'
  })
  const notice = calls.find(call => call.action === 'notify')?.message
  assert.match(notice, /群名：测试群/)
  assert.match(notice, /当前人数：56/)
  assert.equal(new InviteManagementService({ bot }).getPendingRequests()[0]?.flag, 'card-request')
})

test('post-join mode accepts an invitation, then reviews the actual joined group', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.reviewMode = 4
  config.inviteManagement.notifyGroups = [777777]
  Config.saveConfig(config)
  const event = { bot, self_id: '10001', user_id: '30003', group_id: '222222', flag: 'post-join-flag' }
  await new BotInviteRequestHandler().accept(event)
  assert.equal(calls.find(call => call.action === 'set_group_add_request')?.params.approve, true)
  assert.equal(calls.some(call => call.action === 'get_group_info'), false)
  assert.ok(new InviteManagementService({ bot }).getPendingJoin('222222'))

  bot.gl.set(222222, { group_name: '实际群', member_count: 56 })
  const { processGroupJoin } = await import('../model/index.js')
  await processGroupJoin({ ...event, user_id: '10001', operator_id: '30003' })
  let service = new InviteManagementService({ bot })
  const review = service.getStayReviews()[0]
  assert.equal(review.reviewType, 'post_join')
  assert.equal(review.memberCount, 56)
  assert.equal(review.checkedMemberCount, 55)
  assert.equal(service.getPendingJoin('222222'), null)
  assert.match(calls.find(call => call.action === 'notify')?.message, /等待留群审核/)
  assert.match(calls.find(call => call.action === 'notify')?.message, /对比人数：55/)
  assert.equal(calls.some(call => call.action === 'leave'), false)

  const { event: confirm, replies } = command('[CQ:reply,id=444]t确认加群', 't确认加群', {
    message: [{ type: 'reply', id: 444 }, { type: 'text', text: 't确认加群' }]
  })
  await new BotInviteConfirmHandler().handleConfirm(confirm)
  assert.match(replies[0], /已批准机器人留群/)
  service = new InviteManagementService({ bot })
  assert.equal(service.getStayReviews().length, 0)
  assert.equal(calls.some(call => call.action === 'leave'), false)
})

test('direct automatic join also enters post-join review even without a request event', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.reviewMode = 4
  config.inviteManagement.notifyGroups = [777777]
  Config.saveConfig(config)
  bot.gl.set(222222, { group_name: '直接入群', member_count: 56 })
  const { processGroupJoin } = await import('../model/index.js')
  await processGroupJoin({ bot, self_id: '10001', user_id: '10001', group_id: '222222', operator_id: '30003' })
  const review = new InviteManagementService({ bot }).getStayReviews()[0]
  assert.equal(review.reviewType, 'post_join')
  assert.equal(review.userId, '30003')
  assert.equal(review.memberCount, 56)
  const { decideStayReview } = await import('../model/stayReview.js')
  assert.equal((await decideStayReview(review, true, bot)).ok, true)
})

test('cooldown rejects a repeat invitation; only the master can force the next one', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.reviewMode = 4
  Config.saveConfig(config)
  new InviteManagementService({ bot }).setStayCooldown('222222', 10)
  const invite = { bot, self_id: '10001', user_id: '30003', group_id: '222222', flag: 'cooldown-flag' }
  await new BotInviteRequestHandler().accept(invite)
  assert.equal(calls.find(call => call.action === 'set_group_add_request')?.params.approve, false)
  assert.equal(new InviteManagementService({ bot }).getPendingJoin('222222'), null)

  const denied = command('t强制确认加群 222222', 't强制确认加群 222222', { isMaster: false })
  await new BotInviteConfirmHandler().handleConfirm(denied.event)
  assert.match(denied.replies[0], /只有主人/)
  assert.ok(new InviteManagementService({ bot }).getStayCooldown('222222'))

  const forced = command('t强制确认加群 222222', 't强制确认加群 222222')
  await new BotInviteConfirmHandler().handleConfirm(forced.event)
  assert.match(forced.replies[0], /强制放行/)
  const service = new InviteManagementService({ bot })
  assert.equal(service.getStayCooldown('222222'), null)
  assert.equal(service.isApprovedGroup('222222'), true)
})

test('an adapter pickGroup proxy alone does not imply bot membership', () => {
  const service = new InviteManagementService({ bot: { self_id: '10002', gl: new Map(), pickGroup() { return {} } } })
  assert.equal(service.isBotAlreadyInGroup('222222'), false)
})

test('duplicate join notices cannot turn a one-time force approval into a new review', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.reviewMode = 4
  config.inviteManagement.notifyGroups = [777777]
  Config.saveConfig(config)
  bot.gl.set(333333, { group_name: '强制放行群', member_count: 56 })
  new InviteManagementService({ bot }).markApprovedGroup('333333')
  const { handleGroupIncrease } = await import('../model/index.js')
  const event = { bot, self_id: '10001', user_id: '10001', group_id: '333333', operator_id: '30003', time: 12345 }
  await handleGroupIncrease(event)
  await handleGroupIncrease(event)
  const service = new InviteManagementService({ bot })
  assert.equal(service.isApprovedGroup('333333'), false)
  assert.equal(service.getStayReviews().length, 0)
  assert.equal(calls.some(call => call.action === 'leave'), false)
})

test('restart reconciles a saved accepted invitation after the group list becomes ready', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.reviewMode = 4
  config.inviteManagement.notifyGroups = [777777]
  Config.saveConfig(config)
  new InviteManagementService({ bot }).savePendingJoin('222222', '30003')
  const { reconcileStayReviews, decideStayReview } = await import('../model/stayReview.js')
  reconcileStayReviews()
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
  bot.gl.set(222222, { group_name: '恢复的群', member_count: 56 })
  reconcileStayReviews()
  const deadline = Date.now() + 2000
  while (new InviteManagementService({ bot }).getPendingJoin('222222') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const service = new InviteManagementService({ bot })
  const review = service.getStayReviews()[0]
  assert.equal(review?.reviewType, 'post_join')
  assert.equal(service.getPendingJoin('222222'), null)
  assert.equal((await decideStayReview(review, true, bot)).ok, true)
})

test('a direct re-invite during cooldown leaves despite a not-yet-updated group cache', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.reviewMode = 4
  Config.saveConfig(config)
  const service = new InviteManagementService({ bot })
  service.setStayCooldown('222222', 10)
  const originalDeadline = service.getStayCooldown('222222').expiresAt
  const { processGroupJoin } = await import('../model/index.js')
  await processGroupJoin({ bot, self_id: '10001', user_id: '10001', group_id: '222222', operator_id: '30003' })
  const deadline = Date.now() + 4000
  while (!calls.some(call => call.action === 'leave') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(calls.filter(call => call.action === 'leave').length, 1)
  assert.equal(new InviteManagementService({ bot }).getStayCooldown('222222').expiresAt, originalDeadline)
})
