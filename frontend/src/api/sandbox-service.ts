import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 安置沙盘的领域规则都收在这里：周计划、户归属、场地核验通知。
// 存储复用 local-store 的两个键：evacuation_plan（周计划）、site_notice（场地核验通知）。
export const PLAN_KEY = 'evacuation_plan'
export const NOTICE_KEY = 'site_notice'

export const BOARD_STATUSES = ['待动员', '已签约', '已搬迁', '已安置'] as const

// 计划事项按户的当前状态自动推导，拖入计划时不用再手填。
const PLAN_TASK_BY_STATUS: Record<string, string> = {
  待动员: '动员走访',
  已签约: '组织搬迁',
  已搬迁: '安置对接',
  已安置: '安置回访',
  拒绝搬迁: '再动员沟通',
}

// ---------- 周次工具（ISO 8601，周一为一周起点） ----------

export function weekKeyOf(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function mondayOfWeek(weekKey: string): Date {
  const [year, week] = weekKey.split('-W').map(Number)
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dayNum = jan4.getUTCDay() || 7
  const monday = new Date(jan4.getTime())
  monday.setUTCDate(jan4.getUTCDate() - dayNum + 1 + (week - 1) * 7)
  return monday
}

export function shiftWeek(weekKey: string, delta: number): string {
  const monday = mondayOfWeek(weekKey)
  monday.setUTCDate(monday.getUTCDate() + delta * 7)
  return weekKeyOf(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()))
}

export function weekRangeLabel(weekKey: string): string {
  const monday = mondayOfWeek(weekKey)
  const sunday = new Date(monday.getTime())
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (d: Date) =>
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return `${fmt(monday)} ~ ${fmt(sunday)}`
}

// ---------- 户视图 ----------

export function listHouseholds(): EntryRow[] {
  return listRows('evacuation')
}

/** 缺安置地点的户一律视为待补录：进专门泳道展示，不允许被过滤隐藏。 */
export function isSupplementPending(row: EntryRow): boolean {
  return String(row['安置地点'] ?? '').trim() === ''
}

/** 剩余期限：搬迁期限与今天的天数差，负数表示已逾期，null 表示未设期限。 */
export function remainingDays(row: EntryRow): number | null {
  const raw = String(row['搬迁期限'] ?? '').trim()
  if (!raw) {
    return null
  }
  const deadline = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(deadline.getTime())) {
    return null
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((deadline.getTime() - today.getTime()) / 86400000)
}

export function planTaskOf(row: EntryRow): string {
  return PLAN_TASK_BY_STATUS[String(row.status)] ?? '跟进处置'
}

// ---------- 周计划 ----------

function planIds(plan: EntryRow): number[] {
  return String(plan['户清单'] ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
}

function sameIdSet(a: number[], b: number[]): boolean {
  const key = (list: number[]) => [...list].sort((x, y) => x - y).join(',')
  return key(a) === key(b)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nowLabel(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

export function listPlans(): EntryRow[] {
  return listRows(PLAN_KEY)
}

export function plansOfWeek(weekKey: string): EntryRow[] {
  return listPlans().filter((plan) => String(plan['计划周次']) === weekKey)
}

/** 户当前归属的计划（一户同时只属于一个计划，已确认的优先）。 */
export function planOfHousehold(householdId: number): EntryRow | null {
  const owned = listPlans().filter((plan) => planIds(plan).includes(householdId))
  return owned.find((plan) => plan.status === '已确认') ?? owned[0] ?? null
}

export function createPlan(weekKey: string): EntryRow {
  const plans = listPlans()
  const seq = plans.filter((plan) => String(plan['计划周次']) === weekKey).length + 1
  const plan: EntryRow = {
    id: nextId(plans),
    status: '草稿',
    pending: true,
    abnormal: false,
    计划编号: `PLAN-${weekKey.replace('-', '')}-${String(seq).padStart(2, '0')}`,
    计划周次: weekKey,
    所属乡镇: '',
    户清单: '',
    户数: 0,
    创建时间: nowLabel(),
    确认时间: '',
  }
  saveRows(PLAN_KEY, [...plans, plan])
  return plan
}

/**
 * 把户纳入草稿计划。归属规则（同一户被多个计划同时纳入时）：
 * 1. 已确认计划锁定归属，其它计划不得再纳入该户；
 * 2. 同在草稿态时后拖入者优先，自动从原草稿移出；
 * 3. 计划有所属乡镇（首户决定），跨乡镇纳入由视图层先做权属确认，这里只认乡镇一致或空计划。
 */
export function stageHousehold(planId: number, householdId: number): ActionResult {
  const plans = listPlans()
  const plan = plans.find((item) => Number(item.id) === planId)
  if (!plan) {
    return { ok: false, message: '没有找到要纳入的周计划' }
  }
  if (plan.status !== '草稿') {
    return { ok: false, message: '只能往草稿状态的计划里纳户，已确认计划归属已锁定' }
  }
  const household = listHouseholds().find((row) => Number(row.id) === householdId)
  if (!household) {
    return { ok: false, message: '没有找到这户搬迁安置户' }
  }
  const lockedBy = plans.find(
    (item) =>
      item.status === '已确认' && Number(item.id) !== planId && planIds(item).includes(householdId),
  )
  if (lockedBy) {
    return {
      ok: false,
      message: `${household['户号']}已纳入${lockedBy['计划编号']}（已确认），归属已锁定，不能重复纳入`,
    }
  }
  if (planIds(plan).includes(householdId)) {
    return { ok: false, message: `${household['户号']}已在当前计划中，不用重复纳入` }
  }
  let movedFrom = ''
  for (const other of plans) {
    if (other.status === '草稿' && Number(other.id) !== planId && planIds(other).includes(householdId)) {
      const rest = planIds(other).filter((id) => id !== householdId)
      other['户清单'] = rest.join(',')
      other['户数'] = rest.length
      movedFrom = String(other['计划编号'])
    }
  }
  const ids = [...planIds(plan), householdId]
  plan['户清单'] = ids.join(',')
  plan['户数'] = ids.length
  if (!String(plan['所属乡镇'] ?? '').trim()) {
    plan['所属乡镇'] = String(household['所在乡镇'] ?? '')
  }
  saveRows(PLAN_KEY, plans)
  const label = `${household['户号']}已纳入${plan['计划编号']}`
  return movedFrom
    ? { ok: true, message: `${label}，并从${movedFrom}移出（一户只属于一个计划）` }
    : { ok: true, message: label }
}

export function unstageHousehold(planId: number, householdId: number): ActionResult {
  const plans = listPlans()
  const plan = plans.find((item) => Number(item.id) === planId)
  if (!plan) {
    return { ok: false, message: '没有找到要调整的周计划' }
  }
  if (plan.status !== '草稿') {
    return { ok: false, message: '已确认计划不能在沙盘中调整' }
  }
  const rest = planIds(plan).filter((id) => id !== householdId)
  plan['户清单'] = rest.join(',')
  plan['户数'] = rest.length
  if (rest.length === 0) {
    plan['所属乡镇'] = ''
  }
  saveRows(PLAN_KEY, plans)
  return { ok: true, message: '已从计划中移出' }
}

/**
 * 确认周计划：
 * - 重复确认只保留一版：已确认的计划再确认直接拒绝；与同周次已确认计划户清单完全一致的草稿，
 *   确认时撤销草稿、只保留原先那一版；
 * - 确认时把计划内的户从其它草稿中清出，兜底保证一户一计划；
 * - 为每户有安置地点的户生成治理工程页的场地核验通知，通知编号含计划编号与户号，天然幂等；
 *   缺安置地点的待补录户没有场地可核验，不生成通知但在结果里说明。
 */
export function confirmPlan(planId: number): ActionResult {
  const plans = listPlans()
  const plan = plans.find((item) => Number(item.id) === planId)
  if (!plan) {
    return { ok: false, message: '没有找到要确认的周计划' }
  }
  if (plan.status === '已确认') {
    return { ok: false, message: `${plan['计划编号']}已确认过，重复确认只保留一版，不再处理` }
  }
  const ids = planIds(plan)
  if (ids.length === 0) {
    return { ok: false, message: '计划还没有纳入任何安置户，先把户拖进计划托盘' }
  }
  const duplicate = plans.find(
    (item) =>
      item.status === '已确认' &&
      Number(item.id) !== planId &&
      String(item['计划周次']) === String(plan['计划周次']) &&
      sameIdSet(planIds(item), ids),
  )
  if (duplicate) {
    saveRows(PLAN_KEY, plans.filter((item) => Number(item.id) !== planId))
    return {
      ok: true,
      message: `与${duplicate['计划编号']}的户清单完全一致，重复确认只保留一版：已保留原计划，当前草稿已撤销`,
    }
  }
  for (const other of plans) {
    if (other.status === '草稿' && Number(other.id) !== planId) {
      const rest = planIds(other).filter((id) => !ids.includes(id))
      other['户清单'] = rest.join(',')
      other['户数'] = rest.length
    }
  }
  plan.status = '已确认'
  plan.pending = false
  plan['确认时间'] = nowLabel()

  const notices = listRows(NOTICE_KEY)
  const households = listHouseholds()
  let created = 0
  let skipped = 0
  for (const id of ids) {
    const household = households.find((row) => Number(row.id) === id)
    if (!household) {
      continue
    }
    const site = String(household['安置地点'] ?? '').trim()
    if (!site) {
      skipped += 1
      continue
    }
    const code = `SV-${plan['计划编号']}-${household['户号']}`
    if (notices.some((notice) => String(notice['通知编号']) === code)) {
      continue
    }
    notices.push({
      id: nextId(notices),
      status: '待核验',
      pending: true,
      abnormal: false,
      通知编号: code,
      计划编号: String(plan['计划编号']),
      计划周次: String(plan['计划周次']),
      户号: String(household['户号']),
      户主姓名: String(household['户主姓名']),
      所属隐患点: String(household['所属隐患点']),
      安置地点: site,
      生成时间: nowLabel(),
    })
    created += 1
  }
  saveRows(NOTICE_KEY, notices)
  saveRows(PLAN_KEY, plans)
  const tail = skipped > 0 ? `；${skipped}户缺安置地点（待补录），暂不生成` : ''
  return { ok: true, message: `${plan['计划编号']}已确认，已为治理工程页生成${created}条场地核验通知${tail}` }
}

// ---------- 场地核验通知（治理工程页读取） ----------

export function listSiteNotices(): EntryRow[] {
  return listRows(NOTICE_KEY)
}

export function markNoticeVerified(noticeId: number): ActionResult {
  const notices = listRows(NOTICE_KEY)
  const notice = notices.find((item) => Number(item.id) === noticeId)
  if (!notice) {
    return { ok: false, message: '没有找到这条场地核验通知' }
  }
  if (notice.status === '已核验') {
    return { ok: false, message: '该通知已完成核验，不用重复操作' }
  }
  notice.status = '已核验'
  notice.pending = false
  notice['核验时间'] = nowLabel()
  saveRows(NOTICE_KEY, notices)
  return { ok: true, message: `${notice['通知编号']}已核验完成` }
}
