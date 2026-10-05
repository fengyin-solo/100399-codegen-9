<template>
  <section class="page sandbox-page" data-module="evacuation-sandbox">
    <header class="page-head">
      <div>
        <h2>安置沙盘</h2>
        <p class="page-desc">
          按隐患点分区铺开待动员、已签约、已搬迁、已安置户；缺安置地点的户进入待补录泳道，不做隐藏。
          把户卡片拖入右侧计划托盘即可生成周计划。
        </p>
      </div>
      <div class="page-actions">
        <div class="week-switch">
          <button class="btn" type="button" @click="shiftWeekBy(-1)">上一周</button>
          <span class="week-label">{{ weekKey }}（{{ weekRange }}）</span>
          <button class="btn" type="button" @click="shiftWeekBy(1)">下一周</button>
        </div>
        <button class="btn primary" type="button" @click="createDraft">新建周计划</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="sandbox-body">
      <div class="sandbox-board">
        <section v-for="zone in zones" :key="zone.code" class="board-zone">
          <header class="board-zone-head">
            <h3>{{ zone.name }}</h3>
            <span class="zone-meta">
              <span>{{ zone.township }}</span>
              <span v-for="lane in zone.lanes" :key="lane.key">{{ lane.label }} {{ lane.items.length }}</span>
            </span>
          </header>
          <div class="lane-row">
            <div
              v-for="lane in zone.lanes"
              :key="lane.key"
              class="lane"
              :class="{ supplement: lane.key === SUPPLEMENT_LANE }"
            >
              <h4>
                <span>{{ lane.label }}</span>
                <span>{{ lane.items.length }}</span>
              </h4>
              <article
                v-for="card in lane.items"
                :key="card.id"
                class="hh-card"
                :class="{ selected: card.id === selectedId, locked: card.locked }"
                draggable="true"
                @dragstart="onDragStart($event, card.id)"
                @click="selectedId = card.id"
              >
                <span class="card-title">{{ card.户号 }} · {{ card.户主姓名 }}</span>
                <span class="card-sub">{{ card.家庭人口 }}人 · {{ card.安置方式 }}</span>
                <span class="card-badges">
                  <span class="badge">{{ card.status }}</span>
                  <span v-if="card.待补录" class="badge warn">待补录</span>
                  <span v-if="card.planLabel" class="badge plan">{{ card.planLabel }}</span>
                </span>
              </article>
              <p v-if="!lane.items.length" class="lane-empty">暂无</p>
            </div>
          </div>
        </section>
        <p v-if="!zones.length" class="empty-state">暂无搬迁安置户数据</p>
      </div>

      <aside class="sandbox-side">
        <section class="side-block">
          <h3>户详情</h3>
          <dl v-if="selected" class="detail-list">
            <dt>户号</dt>
            <dd>{{ selected.户号 }}</dd>
            <dt>户主</dt>
            <dd>{{ selected.户主姓名 }}</dd>
            <dt>家庭人口</dt>
            <dd>{{ selected.家庭人口 }}人</dd>
            <dt>安置方式</dt>
            <dd>{{ selected.安置方式 }}</dd>
            <dt>安置地点</dt>
            <dd>{{ selected.安置地点Label }}</dd>
            <dt>剩余期限</dt>
            <dd :class="{ 'error-text': selected.逾期 }">{{ selected.剩余期限Label }}</dd>
            <dt>所属隐患点</dt>
            <dd>{{ selected.所属隐患点 }}</dd>
            <dt>所在乡镇</dt>
            <dd>{{ selected.所在乡镇 }}</dd>
            <dt>当前状态</dt>
            <dd>{{ selected.status }}</dd>
            <dt>所在计划</dt>
            <dd>{{ selected.planLabel || '未纳入任何计划' }}</dd>
          </dl>
          <p v-else class="side-hint">点击左侧户卡片，查看家庭人口、安置方式与剩余期限</p>
        </section>

        <section
          class="side-block plan-tray"
          :class="{ 'drag-over': dragOver }"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          <h3>周计划托盘</h3>
          <template v-if="activePlan">
            <p class="tray-meta">
              <strong>{{ activePlan.计划编号 }}</strong>
              <span class="badge" :class="{ plan: activePlan.status === '已确认' }">{{ activePlan.status }}</span>
              <span v-if="activePlan.所属乡镇">计划乡镇：{{ activePlan.所属乡镇 }}</span>
            </p>
            <ul v-if="trayItems.length || pendingCross.length" class="tray-list">
              <li v-for="item in trayItems" :key="item.id" class="tray-item">
                <span>{{ item.户号 }} {{ item.户主姓名 }} · {{ item.计划事项 }}</span>
                <span class="tray-side">
                  <span class="badge">{{ item.所在乡镇 }}</span>
                  <button
                    v-if="activePlan.status === '草稿'"
                    class="link"
                    type="button"
                    @click="unstage(item.id)"
                  >
                    移出
                  </button>
                </span>
              </li>
              <li v-for="item in pendingCross" :key="`cross-${item.id}`" class="tray-item cross">
                <span>{{ item.户号 }}属{{ item.所在乡镇 }}，计划属{{ activePlan.所属乡镇 }}，跨乡镇纳入需权属确认</span>
                <span class="tray-side">
                  <button class="link" type="button" @click="confirmCross(item.id)">确认权属</button>
                  <button class="link" type="button" @click="cancelCross(item.id)">取消</button>
                </span>
              </li>
            </ul>
            <p v-else class="side-hint">把左侧户卡片拖到这里，逐户生成周计划</p>
            <button
              v-if="activePlan.status === '草稿'"
              class="btn primary"
              type="button"
              :disabled="!canConfirm"
              @click="confirmActivePlan"
            >
              确认计划
            </button>
            <p v-if="pendingCross.length" class="side-hint error-text">
              有跨乡镇户待权属确认，处理完后才能确认计划
            </p>
          </template>
          <p v-else class="side-hint">本周还没有计划，点击「新建周计划」或直接把户拖到这里</p>
        </section>

        <section class="side-block">
          <h3>本周计划（{{ weekPlans.length }}）</h3>
          <ul v-if="weekPlans.length" class="plan-list">
            <li
              v-for="plan in weekPlans"
              :key="String(plan.id)"
              :class="{ active: Number(plan.id) === activePlanId }"
              @click="activePlanId = Number(plan.id)"
            >
              <span>{{ plan.计划编号 }}</span>
              <span>{{ plan.status }} · {{ plan.户数 }}户</span>
            </li>
          </ul>
          <p v-else class="side-hint">暂无计划</p>
        </section>
      </aside>
    </div>

    <footer class="page-foot">
      <span>归属规则：一户只属于一个计划，已确认计划锁定归属，草稿之间后拖入者优先；重复确认只保留一版。</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="message" class="ok-text">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  BOARD_STATUSES,
  confirmPlan,
  createPlan,
  isSupplementPending,
  listHouseholds,
  planOfHousehold,
  planTaskOf,
  plansOfWeek,
  remainingDays,
  shiftWeek,
  stageHousehold,
  unstageHousehold,
  weekKeyOf,
  weekRangeLabel,
} from '@/api/sandbox-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const SUPPLEMENT_LANE = '待补录'
const LANE_KEYS: string[] = [...BOARD_STATUSES, SUPPLEMENT_LANE]

type CardModel = {
  id: number
  户号: string
  户主姓名: string
  家庭人口: string | number
  安置方式: string
  status: string
  待补录: boolean
  locked: boolean
  planLabel: string
}

type ZoneModel = {
  code: string
  name: string
  township: string
  lanes: { key: string; label: string; items: CardModel[] }[]
}

type TrayItem = {
  id: number
  户号: string
  户主姓名: string
  所在乡镇: string
  计划事项: string
}

type CrossItem = {
  id: number
  户号: string
  所在乡镇: string
}

const weekKey = ref(weekKeyOf(new Date()))
const weekRange = computed(() => weekRangeLabel(weekKey.value))

const households = ref<EntryRow[]>([])
const weekPlans = ref<EntryRow[]>([])
const zones = ref<ZoneModel[]>([])
const selectedId = ref<number | null>(null)
const activePlanId = ref<number | null>(null)
// 跨乡镇拖入的户先停在待权属确认区（只存在于组件态），确认权属后才真正落库纳入计划
const pendingCross = ref<CrossItem[]>([])
const dragOver = ref(false)
const message = ref('')
const errorMessage = ref('')

function laneOf(row: EntryRow): string {
  if (isSupplementPending(row)) {
    return SUPPLEMENT_LANE
  }
  const status = String(row.status)
  // 拒绝搬迁等非四态的户归入待动员泳道（需要再动员），保证任何户都不被隐藏
  return (BOARD_STATUSES as readonly string[]).includes(status) ? status : BOARD_STATUSES[0]
}

function toCard(row: EntryRow): CardModel {
  const owner = planOfHousehold(Number(row.id))
  return {
    id: Number(row.id),
    户号: String(row['户号'] ?? ''),
    户主姓名: String(row['户主姓名'] ?? ''),
    家庭人口: String(row['家庭人口'] ?? '—'),
    安置方式: String(row['安置方式'] ?? '—'),
    status: String(row.status),
    待补录: isSupplementPending(row),
    locked: owner?.status === '已确认',
    planLabel: owner ? `${owner['计划编号']}${owner.status === '已确认' ? '·已确认' : ''}` : '',
  }
}

function buildZones(): ZoneModel[] {
  const hazards = listRows('hazard')
  const knownCodes = new Set(hazards.map((row) => String(row['隐患点编号'])))
  const grouped = new Map<string, EntryRow[]>()
  for (const row of households.value) {
    const code = String(row['所属隐患点'] ?? '')
    const list = grouped.get(code) ?? []
    list.push(row)
    grouped.set(code, list)
  }
  type ZoneGroup = { code: string; name: string; township: string; rows: EntryRow[] }
  const zonesOut: ZoneGroup[] = hazards
    .map((row) => ({
      code: String(row['隐患点编号']),
      name: String(row['隐患点名称']),
      township: String(row['所在乡镇']),
      rows: grouped.get(String(row['隐患点编号'])) ?? [],
    }))
    .filter((zone) => zone.rows.length > 0)
  // 所属隐患点不在台账里的户归入兜底分区，同样不隐藏
  const orphans = households.value.filter((row) => !knownCodes.has(String(row['所属隐患点'] ?? '')))
  if (orphans.length > 0) {
    zonesOut.push({ code: '__orphan__', name: '未关联隐患点', township: '—', rows: orphans })
  }
  return zonesOut.map((zone) => ({
    code: zone.code,
    name: zone.name,
    township: zone.township,
    lanes: LANE_KEYS.map((key) => ({
      key,
      label: key,
      items: zone.rows.filter((row: EntryRow) => laneOf(row) === key).map(toCard),
    })),
  }))
}

const activePlan = computed<EntryRow | null>(
  () => weekPlans.value.find((plan) => Number(plan.id) === activePlanId.value) ?? null,
)

const trayItems = computed<TrayItem[]>(() => {
  const plan = activePlan.value
  if (!plan) {
    return []
  }
  return String(plan['户清单'] ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => {
      const row = households.value.find((item) => Number(item.id) === id)
      if (!row) {
        return null
      }
      return {
        id,
        户号: String(row['户号'] ?? ''),
        户主姓名: String(row['户主姓名'] ?? ''),
        所在乡镇: String(row['所在乡镇'] ?? ''),
        计划事项: planTaskOf(row),
      }
    })
    .filter((item): item is TrayItem => item !== null)
})

const selected = computed(() => {
  const row = households.value.find((item) => Number(item.id) === selectedId.value)
  if (!row) {
    return null
  }
  const days = remainingDays(row)
  const owner = planOfHousehold(Number(row.id))
  return {
    户号: String(row['户号'] ?? ''),
    户主姓名: String(row['户主姓名'] ?? ''),
    家庭人口: String(row['家庭人口'] ?? '—'),
    安置方式: String(row['安置方式'] ?? '—'),
    安置地点Label: isSupplementPending(row) ? '待补录（缺安置地点）' : String(row['安置地点']),
    剩余期限Label:
      days === null ? '未设期限' : days > 0 ? `剩 ${days} 天` : days === 0 ? '今天到期' : `已逾期 ${-days} 天`,
    逾期: days !== null && days < 0,
    所属隐患点: String(row['所属隐患点'] ?? '—'),
    所在乡镇: String(row['所在乡镇'] ?? '—'),
    status: String(row.status),
    planLabel: owner ? `${owner['计划编号']}（${owner.status}）` : '',
  }
})

const stats = computed(() => [
  { label: '在册搬迁户', value: households.value.length },
  { label: '待补录（缺安置地点）', value: households.value.filter(isSupplementPending).length },
  { label: '本周计划数', value: weekPlans.value.length },
  { label: '本周已确认', value: weekPlans.value.filter((plan) => plan.status === '已确认').length },
])

const canConfirm = computed(() => {
  const plan = activePlan.value
  return (
    !!plan &&
    plan.status === '草稿' &&
    Number(plan['户数'] ?? 0) > 0 &&
    pendingCross.value.length === 0
  )
})

function reload() {
  households.value = listHouseholds()
  weekPlans.value = plansOfWeek(weekKey.value)
  zones.value = buildZones()
  if (!weekPlans.value.some((plan) => Number(plan.id) === activePlanId.value)) {
    const draft = weekPlans.value.find((plan) => plan.status === '草稿')
    const fallback = draft ?? weekPlans.value[0]
    activePlanId.value = fallback ? Number(fallback.id) : null
  }
}

function shiftWeekBy(delta: number) {
  weekKey.value = shiftWeek(weekKey.value, delta)
  pendingCross.value = []
  reload()
}

function createDraft() {
  const plan = createPlan(weekKey.value)
  message.value = `已新建${plan['计划编号']}，把户卡片拖入托盘即可纳入`
  errorMessage.value = ''
  reload()
  activePlanId.value = Number(plan.id)
}

function onDragStart(event: DragEvent, id: number) {
  event.dataTransfer?.setData('text/plain', String(id))
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  const id = Number(event.dataTransfer?.getData('text/plain'))
  if (!Number.isFinite(id) || id <= 0) {
    return
  }
  message.value = ''
  errorMessage.value = ''
  let plan = activePlan.value
  if (!plan || plan.status !== '草稿') {
    const draft = weekPlans.value.find((item) => item.status === '草稿')
    if (draft) {
      activePlanId.value = Number(draft.id)
      plan = draft
    } else {
      const created = createPlan(weekKey.value)
      reload()
      activePlanId.value = Number(created.id)
      plan = created
      message.value = `已自动新建${created['计划编号']}`
    }
  }
  const row = households.value.find((item) => Number(item.id) === id)
  if (!row) {
    return
  }
  const owner = planOfHousehold(id)
  if (owner && owner.status === '已确认' && Number(owner.id) !== Number(plan.id)) {
    errorMessage.value = `${row['户号']}已纳入${owner['计划编号']}（已确认），归属已锁定，不能重复纳入`
    return
  }
  // 跨乡镇拖动：先进入待权属确认区，人工确认权属后才真正纳入
  const planTown = String(plan['所属乡镇'] ?? '').trim()
  const householdTown = String(row['所在乡镇'] ?? '').trim()
  if (planTown && householdTown && planTown !== householdTown) {
    if (!pendingCross.value.some((item) => item.id === id)) {
      pendingCross.value = [
        ...pendingCross.value,
        { id, 户号: String(row['户号']), 所在乡镇: householdTown },
      ]
    }
    errorMessage.value = `${row['户号']}属${householdTown}，与计划所属${planTown}不同乡镇，需先确认权属`
    return
  }
  const result = stageHousehold(Number(plan.id), id)
  if (result.ok) {
    message.value = [message.value, result.message].filter(Boolean).join('；')
  } else {
    errorMessage.value = result.message
  }
  reload()
}

function confirmCross(id: number) {
  const plan = activePlan.value
  if (!plan) {
    return
  }
  const result = stageHousehold(Number(plan.id), id)
  if (result.ok) {
    pendingCross.value = pendingCross.value.filter((item) => item.id !== id)
    message.value = `权属已确认，${result.message}`
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
  }
  reload()
}

function cancelCross(id: number) {
  pendingCross.value = pendingCross.value.filter((item) => item.id !== id)
  errorMessage.value = ''
}

function unstage(id: number) {
  const plan = activePlan.value
  if (!plan) {
    return
  }
  const result = unstageHousehold(Number(plan.id), id)
  if (result.ok) {
    message.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
  }
  reload()
}

function confirmActivePlan() {
  const plan = activePlan.value
  if (!plan) {
    return
  }
  const result = confirmPlan(Number(plan.id))
  if (result.ok) {
    message.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    message.value = ''
  }
  reload()
}

watch(activePlanId, () => {
  // 待权属确认是针对具体计划的，切换计划后作废
  pendingCross.value = []
})

onMounted(reload)
</script>
