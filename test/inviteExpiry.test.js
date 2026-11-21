import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-leave-invite-expiry-')))
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }

const { Config, DEFAULT_INVITE_MESSAGES } = await import('../components/config.js')
const { InviteManagementService, reconcilePendingInviteRequests } = await import('../model/inviteManagement.js')
const { setConfigData } = await import('../model/guoba/setConfigData.js')
const { getConfigData } = await import('../model/guoba/getConfigData.js')

const messages = []
const bot = {
  self_id: '10001',
  pickFriend(userId) {
    return {
      async sendMsg(message) {
        messages.push({ userId, message })
      }
    }
  }
}
globalThis.Bot = bot

function resetConfig(notifyInviterOnExpiry = true) {
  const config = Config.loadConfig()
  config.inviteManagement.pendingRequests = []
  config.inviteManagement.requestExpireMinutes = 1
  config.inviteManagement.notifyInviterOnExpiry = notifyInviterOnExpiry
  Config.saveConfig(config)
  messages.length = 0
}

function request(requestId, requestTime) {
  return {
    requestId,
    botId: '10001',
    groupId: '123456',
    groupName: '测试群',
    userId: '20002',
    nickname: '邀请者',
    flag: requestId,
    subType: 'invite',
    noticeSent: true,
    requestTime
  }
}

test('Guoba saves and reads the expiry notification switch', async () => {
  resetConfig()
  const result = await setConfigData({
    'inviteManagement.notifyInviterOnExpiry': false
  }, {
    Result: { ok: () => ({ ok: true }), error: message => ({ ok: false, message }) }
  })
  assert.equal(result.ok, true)
  assert.equal((await getConfigData()).inviteManagement.notifyInviterOnExpiry, false)
  assert.equal(new InviteManagementService({ bot }).config.notifyInviterOnExpiry, false)
})

test('Guoba saves post-join settings without overwriting live review state', async () => {
  resetConfig()
  const snapshot = await getConfigData()
  snapshot.inviteManagement.reviewMode = 4
  snapshot.inviteManagement.stayReviewCooldownMinutes = 0
  const config = Config.loadConfig()
  const now = Date.now()
  config.inviteManagement.pendingJoins = [{ botId: '10001', groupId: '123456', userId: '20002', createdAt: now, expiresAt: now + 60000 }]
  config.inviteManagement.stayReviewCooldowns = [{ botId: '10001', groupId: '654321', expiresAt: now + 60000 }]
  Config.saveConfig(config)
  const result = await setConfigData(snapshot, {
    Result: { ok: () => ({ ok: true }), error: message => ({ ok: false, message }) }
  })
  assert.equal(result.ok, true)
  const readback = await getConfigData()
  assert.equal(readback.inviteManagement.reviewMode, 4)
  assert.equal(readback.inviteManagement.stayReviewCooldownMinutes, 0)
  assert.equal(readback.inviteManagement.pendingJoins.length, 1)
  assert.equal(readback.inviteManagement.stayReviewCooldowns.length, 1)
})

test('an unanswered invite sends its inviter one end notice at expiry', async () => {
  resetConfig()
  const service = new InviteManagementService({ bot })
  const delivered = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('expiry notice timed out')), 1000)
    bot.pickFriend = userId => ({
      async sendMsg(message) {
        messages.push({ userId, message })
        clearTimeout(timeout)
        resolve()
      }
    })
  })
  service.addPendingRequest(request('expires-soon', Date.now() - 59900))
  await delivered
  assert.equal(messages.length, 1)
  assert.equal(messages[0].userId, 20002)
  assert.match(messages[0].message, /审核已结束/)
  assert.match(messages[0].message, /群号：123456/)
  assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
  reconcilePendingInviteRequests()
  assert.equal(messages.length, 1)
})

test('resolved invites do not send expiry notices', async () => {
  resetConfig()
  const service = new InviteManagementService({ bot })
  service.addPendingRequest(request('resolved', Date.now() - 59800))
  service.removePendingRequest('resolved')
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(messages.length, 0)
})

test('restart recovery notifies for an expired persisted invite', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.pendingRequests = [request('before-restart', Date.now() - 61000)]
  Config.saveConfig(config)
  reconcilePendingInviteRequests()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(messages.length, 1)
  assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
  reconcilePendingInviteRequests()
  assert.equal(messages.length, 1)
})

test('restart recovery schedules a still-pending invitation', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteManagement.pendingRequests = [request('pending-at-restart', Date.now() - 59900)]
  Config.saveConfig(config)
  const delivered = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('recovered notice timed out')), 1000)
    bot.pickFriend = userId => ({
      async sendMsg(message) {
        messages.push({ userId, message })
        clearTimeout(timeout)
        resolve()
      }
    })
  })
  reconcilePendingInviteRequests()
  await delivered
  assert.equal(messages.length, 1)
  assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
})

test('restart recovery sends a notice interrupted before delivery only once', async () => {
  resetConfig()
  const notices = []
  bot.sendGroupMsg = async (groupId, message) => {
    notices.push({ groupId, message })
    return { message_id: 555 }
  }
  try {
    const config = Config.loadConfig()
    config.inviteManagement.notifyGroups = [777777]
    config.inviteManagement.pendingRequests = [{ ...request('interrupted-notice', Date.now()), noticeSent: false }]
    Config.saveConfig(config)
    reconcilePendingInviteRequests()
    const deadline = Date.now() + 1000
    while (!new InviteManagementService({ bot }).getPendingRequests()[0]?.noticeSent && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    const saved = new InviteManagementService({ bot }).getPendingRequests()[0]
    assert.equal(saved.noticeSent, true)
    assert.ok(saved.msgIds.includes('555'))
    reconcilePendingInviteRequests()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(notices.length, 1)
  } finally {
    delete bot.sendGroupMsg
    const config = Config.loadConfig()
    config.inviteManagement.notifyGroups = []
    config.inviteManagement.pendingRequests = []
    Config.saveConfig(config)
  }
})

test('legacy invitations without a notice flag do not resend an already delivered private notice', async () => {
  resetConfig()
  const notices = []
  bot.sendGroupMsg = async (groupId, message) => {
    notices.push({ groupId, message })
    return { message_id: 556 }
  }
  try {
    const legacy = request('legacy-private-notice', Date.now())
    delete legacy.noticeSent
    const config = Config.loadConfig()
    config.inviteManagement.notifyGroups = [777777]
    config.inviteManagement.pendingRequests = [legacy]
    Config.saveConfig(config)
    reconcilePendingInviteRequests()
    await new Promise(resolve => setTimeout(resolve, 50))
    const service = new InviteManagementService({ bot })
    assert.equal(service.getPendingRequests()[0]?.noticeSent, true)
    assert.equal(notices.length, 0)
    service.removePendingRequest('legacy-private-notice')
  } finally {
    delete bot.sendGroupMsg
    const config = Config.loadConfig()
    config.inviteManagement.notifyGroups = []
    config.inviteManagement.pendingRequests = []
    Config.saveConfig(config)
  }
})

test('reading expired requests sends the end notice once without a recovery sweep', async () => {
  resetConfig()
  const config = Config.loadConfig()
  config.inviteMessages.inviteExpired = '审核超时：{groupId} / {groupName}'
  config.inviteManagement.pendingRequests = [request('lazy-expiry', Date.now() - 61000)]
  Config.saveConfig(config)
  const service = new InviteManagementService({ bot })
  assert.deepEqual(service.cleanExpiredPendingRequests(), [])
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(messages.map(item => item.message), ['审核超时：123456 / 测试群'])
  assert.deepEqual(service.cleanExpiredPendingRequests(), [])
  assert.equal(messages.length, 1)
})

test('disabled expiry notices still clear expired invitations', async () => {
  resetConfig(false)
  const config = Config.loadConfig()
  config.inviteManagement.pendingRequests = [request('no-notice', Date.now() - 61000)]
  Config.saveConfig(config)
  reconcilePendingInviteRequests()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(messages.length, 0)
  assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
})

test('restart restores an already joined invitation as the same stay review', async () => {
  resetConfig()
  bot.gl = new Map([[123456, { group_name: '测试群', member_count: 20 }]])
  try {
    const config = Config.loadConfig()
    config.inviteManagement.pendingRequests = [{ ...request('already-joined', Date.now() - 1000), msgIds: ['123'] }]
    Config.saveConfig(config)
    reconcilePendingInviteRequests()
    const deadline = Date.now() + 1000
    let service = new InviteManagementService({ bot })
    while (!service.getStayReviews().length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
      service = new InviteManagementService({ bot })
    }
    const review = service.getStayReviews()[0]
    assert.equal(review?.requestId, 'already-joined')
    assert.ok(review.msgIds.includes('123'))
    assert.equal(service.getPendingRequests().length, 0)
    assert.equal(messages.length, 0)
    const { decideStayReview } = await import('../model/stayReview.js')
    assert.equal((await decideStayReview(review, true, bot)).ok, true)
    await new Promise(resolve => setImmediate(resolve))
  } finally {
    delete bot.gl
  }
})

test('an already joined legacy invitation is not treated as an unapproved expired review', async () => {
  resetConfig()
  bot.gl = new Map([[123456, { group_name: '测试群', member_count: 20 }]])
  try {
    const legacy = request('legacy-already-joined', Date.now() - 61000)
    delete legacy.noticeSent
    const config = Config.loadConfig()
    config.inviteManagement.pendingRequests = [legacy]
    Config.saveConfig(config)
    reconcilePendingInviteRequests()
    const deadline = Date.now() + 1000
    let service = new InviteManagementService({ bot })
    while (service.getPendingRequests().length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
      service = new InviteManagementService({ bot })
    }
    assert.equal(service.getPendingRequests().length, 0)
    assert.equal(service.getStayReviews().length, 0)
    assert.equal(messages.length, 1)
    assert.match(messages[0].message, /历史邀请审核状态无法确认/)
    assert.doesNotMatch(messages[0].message, /未处理|退群/)
    await new Promise(resolve => setImmediate(resolve))
  } finally {
    delete bot.gl
  }
})

test('an externally handled invitation is cleared and reported before its deadline', async () => {
  resetConfig()
  bot.sendApi = async action => {
    if (action === 'get_group_system_msg') return { status: 'ok', data: [{
      group_id: 123456, requester_uin: 10001, checked: true, flag: 'handled-before-expiry'
    }] }
    throw new Error('unsupported')
  }
  try {
    const config = Config.loadConfig()
    config.inviteManagement.pendingRequests = [request('handled-before-expiry', Date.now() - 59800)]
    Config.saveConfig(config)
    reconcilePendingInviteRequests()
    const deadline = Date.now() + 1000
    while (!messages.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(new InviteManagementService({ bot }).getPendingRequests().length, 0)
    assert.equal(messages.length, 1)
    assert.match(messages[0].message, /已.*处理/)
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(messages.length, 1)
  } finally {
    delete bot.sendApi
  }
})

test('a checked request for another target does not resolve the invitation', async () => {
  resetConfig()
  bot.sendApi = async action => {
    if (action === 'get_group_system_msg') return { status: 'ok', data: [{
      group_id: 123456, requester_uin: 99999, checked: true, flag: 'wrong-target'
    }] }
    throw new Error('unsupported')
  }
  try {
    const config = Config.loadConfig()
    config.inviteManagement.pendingRequests = [request('wrong-target', Date.now())]
    Config.saveConfig(config)
    reconcilePendingInviteRequests()
    await new Promise(resolve => setTimeout(resolve, 50))
    const service = new InviteManagementService({ bot })
    assert.equal(service.getPendingRequests().length, 1)
    assert.equal(messages.length, 0)
    service.removePendingRequest('wrong-target')
  } finally {
    delete bot.sendApi
  }
})

test('a system request already handled elsewhere does not generate an unhandled expiry', async () => {
  resetConfig()
  bot.sendApi = async action => {
    if (action === 'get_group_system_msg') return { status: 'ok', data: [{
      group_id: 123456, requester_uin: 10001, checked: true, flag: 'handled-elsewhere'
    }] }
    throw new Error('unsupported')
  }
  try {
    const config = Config.loadConfig()
    config.inviteManagement.pendingRequests = [request('handled-elsewhere', Date.now() - 61000)]
    Config.saveConfig(config)
    reconcilePendingInviteRequests()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(messages.length, 1)
    assert.match(messages[0].message, /已.*处理/)
    assert.doesNotMatch(messages[0].message, /未处理/)
  } finally {
    delete bot.sendApi
  }
})

test('legacy invite notice templates migrate and custom templates remain unchanged', async () => {
  for (const prefix of ['#', 't']) {
    const oldTemplate = `机器人加群邀请\n群号：{groupId}\n群名：{groupName}\n邀请人：{userId}\n邀请人昵称：{nickname}\n请求ID：{requestId}\n\n处理方式：引用本消息发送 ${prefix}确认加群 或 ${prefix}拒绝加群\n备用方式：${prefix}确认加群 {groupId}\n有效期：{expireMinutes} 分钟`
    const config = Config.loadConfig()
    config.inviteMessages.reviewNotification = oldTemplate
    assert.equal(Config.saveConfig(config), true)
    const loaded = Config.loadConfig()
    assert.equal(loaded.inviteMessages.reviewNotification, DEFAULT_INVITE_MESSAGES.reviewNotification)
    const saved = JSON.parse(fs.readFileSync(path.join(Config.configPath, 'config.json'), 'utf8'))
    assert.equal(saved.inviteMessages.reviewNotification, DEFAULT_INVITE_MESSAGES.reviewNotification)
    assert.equal((await getConfigData()).inviteMessages.reviewNotification, DEFAULT_INVITE_MESSAGES.reviewNotification)
  }

  const config = Config.loadConfig()
  config.inviteMessages.reviewNotification = '自定义通知：{groupName}'
  Config.saveConfig(config)
  assert.equal(Config.loadConfig().inviteMessages.reviewNotification, '自定义通知：{groupName}')
  assert.equal((await getConfigData()).inviteMessages.reviewNotification, '自定义通知：{groupName}')
})

test('previous default invite and expiry wording is migrated without changing custom wording', () => {
  const config = Config.loadConfig()
  config.inviteMessages.reviewNotification = '机器人加群邀请\n群号：{groupId}\n群名：{groupName}\n当前人数：{memberCount}\n邀请人：{userId}\n邀请人昵称：{nickname}\n请求ID：{requestId}\n\n处理方式：引用本消息发送 t确认加群 或 t拒绝加群\n备用方式：t确认加群 {groupId}\n有效期：{expireMinutes} 分钟\n{precheckNotice}'
  config.inviteMessages.inviteExpired = '群邀请审核已结束\n群号：{groupId}\n群名：{groupName}\n原因：审核有效期内未处理\n机器人未处理本次邀请，如需入群请重新邀请'
  Config.saveConfig(config)
  const loaded = Config.loadConfig()
  assert.equal(loaded.inviteMessages.reviewNotification, DEFAULT_INVITE_MESSAGES.reviewNotification)
  assert.equal(loaded.inviteMessages.inviteExpired, DEFAULT_INVITE_MESSAGES.inviteExpired)
})
