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
let leaves = 0
const bot = {
  uin: '10001',
  cfg: { master: [] },
  gl: new Map([['123456', { member_count: 49, group_name: '测试群' }]]),
  pickGroup() {
    return { info: { group_name: '测试群' } }
  },
  async sendApi(action) {
    if (action === 'get_group_info') return { data: { group_name: '测试群', member_count: 49 } }
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
