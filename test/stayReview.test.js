import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-stay-test-')))
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }

const { Config } = await import('../components/config.js')
const { InviteManagementService } = await import('../model/inviteManagement.js')
const { checkAndLeaveGroupWithRetry } = await import('../model/groupCheck.js')
const { beginStayReview, decideStayReview, expireStayReview, reconcileStayReviews } = await import('../model/stayReview.js')

const messages = []
const privateMessages = []
let leaves = 0
const bot = {
  uin: '10001',
  cfg: { master: [] },
  gl: new Map([['123456', { member_count: 49, group_name: '测试群' }]]),
  pickGroup() {
    return { info: { group_name: '测试群' } }
  },
  async sendApi(action, params) {
    if (action === 'get_group_info') return { data: { group_name: '测试群', member_count: 49 } }
    if (action === 'get_group_list') return { data: [...this.gl.keys()].map(group_id => ({ group_id })) }
    if (action === 'send_private_msg') {
      privateMessages.push(params)
      return { status: 'ok', retcode: 0 }
    }
    throw new Error(`unexpected action: ${action}`)
  },
  async sendGroupMsg(groupId, message) {
    messages.push(message)
    return { message_id: messages.length + 100 }
  },
  async setGroupLeave() {
    leaves++
  }
}
globalThis.Bot = bot

const config = Config.loadConfig()
config.notification.enabled = false
config.inviteManagement.notifyGroups = [777777]
config.inviteManagement.notifyUsers = []
config.inviteManagement.stayReviewMinutes = 10
Config.saveConfig(config)

test('low member join creates persistent review with a count; approval keeps bot in group', async () => {
  const result = await checkAndLeaveGroupWithRetry('123456', bot, 0, beginStayReview)
  assert.equal(result, true)
  const service = new InviteManagementService({ bot })
  const review = service.getStayReviews()[0]
  assert.equal(review.memberCount, 49)
  assert.ok(review.expiresAt > Date.now())
  assert.match(messages[0], /当前人数：49/)
  assert.match(messages[0], /截止时间：/)
  assert.equal(service.findStayReviews({ msgId: '101' })[0].requestId, review.requestId)
  assert.equal(leaves, 0)

  const decision = await decideStayReview(review, true, bot)
  assert.equal(decision.ok, true)
  assert.match(decision.message, /批准机器人留群/)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
  assert.equal(leaves, 0)
})

test('member count lookup accepts a numeric cache key for a string group id', async () => {
  let found = null
  const numericCacheBot = { gl: new Map([[123456, { member_count: 49 }]]) }
  const result = await checkAndLeaveGroupWithRetry('123456', numericCacheBot, 0, async (groupId, count) => {
    found = { groupId, count }
    return true
  })
  assert.equal(result, true)
  assert.deepEqual(found, { groupId: '123456', count: 49 })
})

test('a cancelled membership check cannot leave after its delay', async () => {
  const { executeLeaveGroup } = await import('../model/groupCheck.js')
  let current = true
  const before = leaves
  const task = executeLeaveGroup({
    groupId: '123456', bot, groupName: '测试群', skipGroupMessage: true, shouldLeave: () => current
  })
  current = false
  assert.equal(await task, false)
  assert.equal(leaves, before)
})

test('rejecting an already joined bot leaves the group once', async () => {
  await beginStayReview('123456', 49, bot)
  const review = new InviteManagementService({ bot }).getStayReviews()[0]
  const decision = await decideStayReview(review, false, bot)
  assert.equal(decision.ok, true)
  assert.equal(leaves, 1)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
  assert.equal((await decideStayReview(review, true, bot)).ok, false)
})

test('recovery processes expired persistent review after a restart', async () => {
  const service = new InviteManagementService({ bot })
  const review = {
    requestId: '10001-stay-expired',
    botId: '10001',
    groupId: '123456',
    groupName: '测试群',
    memberCount: 49,
    requestTime: Date.now() - 60000,
    expiresAt: Date.now() - 1,
    status: 'pending',
    msgIds: [],
    manageGroupIds: [777777]
  }
  service.saveStayReview(review)
  reconcileStayReviews()

  const until = Date.now() + 5000
  while (leaves < 2 && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.equal(leaves, 2)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
})

test('expired review waits for group cache to become ready', async () => {
  const review = {
    requestId: '10001-stay-cache-loading',
    botId: '10001',
    groupId: '123456',
    groupName: '测试群',
    memberCount: 49,
    requestTime: Date.now() - 60000,
    expiresAt: Date.now() - 1,
    status: 'pending',
    msgIds: [],
    manageGroupIds: [777777]
  }
  new InviteManagementService({ bot }).saveStayReview(review)
  const groups = bot.gl
  bot.gl = new Map()
  try {
    assert.equal(await expireStayReview(review, bot), false)
    assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 1)
    assert.equal(leaves, 2)
  } finally {
    bot.gl = groups
  }

  assert.equal(await expireStayReview(review, bot), true)
  assert.equal(leaves, 3)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
})

test('recovery retries a leave interrupted by restart', async () => {
  const review = {
    requestId: '10001-stay-interrupted',
    botId: '10001',
    groupId: '123456',
    groupName: '测试群',
    memberCount: 49,
    requestTime: Date.now() - 60000,
    expiresAt: Date.now() - 1,
    status: 'leaving',
    msgIds: [],
    manageGroupIds: [777777]
  }
  new InviteManagementService({ bot }).saveStayReview(review)
  assert.equal(await expireStayReview(review, bot), true)
  assert.equal(leaves, 4)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
})

test('an expiry racing a manual decision leaves at most once', async () => {
  const review = {
    requestId: '10001-stay-race',
    botId: '10001',
    groupId: '123456',
    groupName: '测试群',
    memberCount: 49,
    requestTime: Date.now() - 60000,
    expiresAt: Date.now() - 1,
    status: 'pending',
    msgIds: [],
    manageGroupIds: [777777]
  }
  new InviteManagementService({ bot }).saveStayReview(review)
  const [decision] = await Promise.all([
    decideStayReview(review, true, bot),
    expireStayReview(review, bot)
  ])
  assert.equal(decision.ok, false)
  assert.equal(leaves, 5)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
})

test('undeliverable review notices do not leave an unreviewable pending state', async () => {
  const send = bot.sendGroupMsg
  bot.sendGroupMsg = async () => { throw new Error('通知群不可用') }
  try {
    assert.equal(await beginStayReview('123456', 49, bot), false)
    assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
  } finally {
    bot.sendGroupMsg = send
  }
})

test('an already left group is removed from persistent reviews without a second leave', async () => {
  const review = {
    requestId: '10001-stay-already-left',
    botId: '10001',
    groupId: '654321',
    groupName: '已退出的群',
    memberCount: 20,
    requestTime: Date.now() - 60000,
    expiresAt: Date.now() - 1,
    status: 'pending',
    msgIds: [],
    manageGroupIds: [777777]
  }
  new InviteManagementService({ bot }).saveStayReview(review)
  assert.equal(await expireStayReview(review, bot), true)
  assert.equal(leaves, 5)
  assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 0)
})

test('post-join review remains scheduled even when every notice fails', async () => {
  const send = bot.sendGroupMsg
  bot.sendGroupMsg = async () => { throw new Error('通知群不可用') }
  try {
    assert.equal(await beginStayReview('123456', null, bot, { reviewType: 'post_join', userId: '30003' }), true)
    const review = new InviteManagementService({ bot }).getStayReviews()[0]
    assert.equal(review.noticeSent, false)
    assert.ok(review.expiresAt > Date.now())
    assert.equal((await decideStayReview(review, true, bot)).ok, true)
  } finally {
    bot.sendGroupMsg = send
  }
})

test('an interrupted rejection is retried immediately, even before its original deadline', async () => {
  const review = {
    requestId: '10001-stay-rejected-before-restart', botId: '10001', groupId: '123456',
    groupName: '测试群', memberCount: 49, reviewType: 'post_join', cooldownMinutes: 10,
    requestTime: Date.now() - 1000, expiresAt: Date.now() + 600000,
    status: 'leaving', leaveReason: '留群审核被拒绝', msgIds: [], manageGroupIds: []
  }
  new InviteManagementService({ bot }).saveStayReview(review)
  const before = leaves
  assert.equal(await expireStayReview(review, bot), true)
  assert.equal(leaves, before + 1)
  const service = new InviteManagementService({ bot })
  assert.equal(service.getStayReviews().length, 0)
  assert.ok(service.getStayCooldown('123456')?.expiresAt > Date.now())
  const other = new InviteManagementService({ bot: { self_id: '10002' } })
  assert.equal(other.getStayCooldown('123456'), null)
})

test('a failed leave remains pending and does not start the cooldown', async () => {
  const service = new InviteManagementService({ bot })
  service.clearStayCooldown('123456')
  const review = {
    requestId: '10001-stay-protocol-failed', botId: '10001', groupId: '123456',
    groupName: '测试群', memberCount: 49, reviewType: 'post_join', cooldownMinutes: 10,
    requestTime: Date.now() - 60000, expiresAt: Date.now() - 1,
    status: 'pending', msgIds: [], manageGroupIds: []
  }
  service.saveStayReview(review)
  const leave = bot.setGroupLeave
  bot.setGroupLeave = async () => ({ status: 'failed', retcode: 100 })
  try {
    assert.equal(await expireStayReview(review, bot), false)
    const latest = new InviteManagementService({ bot })
    assert.equal(latest.getStayReviews()[0].status, 'pending')
    assert.equal(latest.getStayCooldown('123456'), null)
    latest.removeStayReview(review)
  } finally {
    bot.setGroupLeave = leave
  }
})

test('ambiguous startup membership keeps the expired review for a later retry', async () => {
  const review = {
    requestId: '10001-stay-unknown-membership', botId: '10001', groupId: '999999',
    groupName: '等待群列表', memberCount: null, reviewType: 'post_join',
    requestTime: Date.now() - 60000, expiresAt: Date.now() - 1,
    status: 'pending', msgIds: [], manageGroupIds: []
  }
  new InviteManagementService({ bot }).saveStayReview(review)
  const getApi = bot.sendApi
  bot.sendApi = async () => { throw new Error('群列表尚未就绪') }
  try {
    assert.equal(await expireStayReview(review, bot), false)
    assert.equal(new InviteManagementService({ bot }).getStayReviews().length, 1)
    new InviteManagementService({ bot }).removeStayReview(review)
  } finally {
    bot.sendApi = getApi
  }
})

test('recovered expiry notifies reviewers and respects the inviter notification switch', async () => {
  for (const enabled of [true, false]) {
    const config = Config.loadConfig()
    config.inviteManagement.notifyInviterOnExpiry = enabled
    Config.saveConfig(config)
    privateMessages.length = 0
    messages.length = 0
    const review = {
      requestId: `10001-expired-notice-${enabled}`, botId: '10001', groupId: '654321',
      groupName: '已退出的群', userId: '30003', memberCount: 49, reviewType: 'post_join', cooldownMinutes: 10,
      requestTime: Date.now() - 60000, expiresAt: Date.now() - 1,
      status: 'leaving', leaveReason: '留群审核超时', msgIds: [], manageGroupIds: ['777777']
    }
    new InviteManagementService({ bot }).saveStayReview(review)
    assert.equal(await expireStayReview(review, bot), true)
    assert.ok(messages.some(message => /审核已结束，机器人已退群/.test(message)))
    assert.equal(privateMessages.length, enabled ? 1 : 0)
    if (enabled) assert.match(privateMessages[0].message, /审核已结束，机器人已退群/)
  }
})
