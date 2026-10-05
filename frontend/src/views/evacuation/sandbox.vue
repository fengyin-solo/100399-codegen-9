<template>
  <section class="page" data-module="evacuation-sandbox">
    <header class="page-head">
      <div>
        <h2>避险搬迁安置沙盘</h2>
        <p class="page-desc">
          按隐患点分区铺开待动员、已签约、已搬迁、已安置户；把户卡拖进右侧周计划，确认后自动向治理工程页推送场地核验通知。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/evacuation">返回搬迁列表</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section v-if="missingLocation.length" class="missing-panel">
      <header class="missing-head">
        <strong>待补录 · {{ missingLocation.length }} 户缺安置地点</strong>
        <span>历史缺安置地点的户在此公示补录，不会被隐藏；补录完成后计划才能确认。</span>
      </header>
      <ul class="missing-list">
        <li v-for="row in missingLocation" :key="row.id" class="missing-item">
          <span class="missing-label">
            {{ row['户号'] }} · {{ row['户主姓名'] }} · {{ row['所属隐患点'] }}（{{ row.status }}）
          </span>
          <input
            v-model="supplementInputs[Number(row.id)]"
            class="missing-input"
            placeholder="填写安置地点，如：青溪镇桂花安置小区"
          />
          <button class="btn" type="button" @click="saveSupplement(row)">补录保存</button>
        </li>
      </ul>
    </section>

    <div class="sandbox-layout">
      <div class="sandbox-board">
        <section v-for="zone in zones" :key="zone.name" class="zone">
          <header class="zone-head">
            <strong>{{ zone.name }}</strong>
            <span class="zone-meta">{{ zone.township || '乡镇未登记' }} · 共 {{ zone.total }} 户</span>
          </header>
          <div class="zone-columns">
            <div v-for="column in zone.columns" :key="column.status" class="lane">
              <h4 class="lane-title">{{ column.status }}（{{ column.rows.length }}）</h4>
              <article
                v-for="row in column.rows"
                :key="row.id"
                class="house-card"
                :class="{ selected: selectedId === Number(row.id), missing: isMissing(row) }"
                draggable="true"
                @dragstart="onDragStart(row, $event)"
                @dragend="draggingId = null"
                @click="selectedId = Number(row.id)"
              >
                <header class="house-head">
                  <strong>{{ row['户主姓名'] }}</strong>
                  <span>{{ row['户号'] }}</span>
                </header>
                <p class="house-line">{{ row['家庭人口'] }} 人 · {{ row['安置方式'] }}</p>
                <p class="house-line" :class="remainingClass(row)">{{ remainingLabel(row) }}</p>
                <p v-if="isMissing(row)" class="house-flag">缺安置地点 · 待补录</p>
              </article>
              <p v-if="!column.rows.length" class="lane-empty">暂无</p>
            </div>
          </div>
        </section>
      </div>

      <aside class="sandbox-side">
        <section class="side-card">
          <h3 class="side-title">户情侧栏</h3>
          <template v-if="selected">
            <dl class="detail-list">
              <div><dt>户号</dt><dd>{{ selected['户号'] }}</dd></div>
              <div><dt>户主</dt><dd>{{ selected['户主姓名'] }}</dd></div>
              <div><dt>家庭人口</dt><dd>{{ selected['家庭人口'] }} 人</dd></div>
              <div><dt>安置方式</dt><dd>{{ selected['安置方式'] }}</dd></div>
              <div>
                <dt>安置地点</dt>
                <dd>
                  <span v-if="isMissing(selected)" class="error-text">待补录</span>
                  <template v-else>{{ selected['安置地点'] }}</template>
                </dd>
              </div>
              <div><dt>剩余期限</dt><dd :class="remainingClass(selected)">{{ remainingLabel(selected) }}</dd></div>
              <div><dt>所属隐患点</dt><dd>{{ selected['所属隐患点'] }}</dd></div>
              <div><dt>所在乡镇</dt><dd>{{ selected['所在乡镇'] }}</dd></div>
              <div><dt>搬迁状态</dt><dd>{{ selected.status }}</dd></div>
            </dl>
            <button
              class="btn primary side-add"
              type="button"
              :disabled="!activeDraft"
              @click="addSelectedToActivePlan"
            >
              加入当前计划{{ activeDraft ? `（${activeDraft.计划编号}）` : '' }}
            </button>
          </template>
          <p v-else class="side-hint">点击左侧户卡，这里会显示家庭人口、安置方式和剩余期限。</p>
        </section>

        <section class="side-card">
          <h3 class="side-title">周计划</h3>
          <div class="plan-create">
            <select v-model="newPlanWeek" class="plan-week">
              <option v-for="option in weekChoices" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <button class="btn primary" type="button" @click="createNewPlan">新建周计划</button>
          </div>
          <p class="side-hint">
            归属规则：已确认计划优先锁定；草稿之间一户只属一个计划，拖入新计划自动从旧草稿移出；重复确认只保留一版。
          </p>
          <p v-if="!plans.length" class="side-hint">还没有周计划，先新建一个。</p>
          <article
            v-for="plan in plans"
            :key="plan.id"
            class="plan-card"
            :class="{ active: plan.id === activePlanId, confirmed: plan.status === '已确认' }"
            @click="plan.status === '草稿' && (activePlanId = plan.id)"
          >
            <header class="plan-head">
              <strong>{{ plan.计划编号 }}</strong>
              <span class="plan-status">{{ plan.status }}</span>
            </header>
            <p class="plan-meta">
              {{ plan.计划周 }} · {{ plan.所在乡镇 || '乡镇待定' }} · {{ plan.户Ids.length }} 户
            </p>
            <div
              v-if="plan.status === '草稿'"
              class="plan-drop"
              :class="{ armed: draggingId !== null && plan.id === activePlanId }"
              @dragover.prevent
              @drop="onDropToPlan(plan, $event)"
            >
              把户卡拖到这里纳入本计划
            </div>
            <ul v-if="planMembers(plan).length" class="plan-members">
              <li v-for="member in planMembers(plan)" :key="member.id">
                <span>
                  {{ member['户号'] }} · {{ member['户主姓名'] }}
                  <em v-if="isCrossTownship(plan, member)" class="cross-tag">跨乡镇</em>
                  <em v-if="isMissing(member)" class="missing-tag">待补录</em>
                </span>
                <button
                  v-if="plan.status === '草稿'"
                  class="link"
                  type="button"
                  @click.stop="removeFromPlan(plan, member)"
                >
                  移出
                </button>
              </li>
            </ul>
            <footer v-if="plan.status === '草稿'" class="plan-foot">
              <button class="btn primary" type="button" @click.stop="confirm(plan)">确认计划</button>
              <button class="btn ghost" type="button" @click.stop="removePlan(plan)">删除草稿</button>
            </footer>
            <footer v-else class="plan-foot confirmed-foot">
              确认时间：{{ plan.确认时间 }} · 已推送场地核验通知
            </footer>
          </article>
        </section>
      </aside>
    </div>

    <div v-if="ownershipDialog" class="modal-mask">
      <div class="modal">
        <h3>跨乡镇权属确认</h3>
        <p>
          该户属于【{{ ownershipDialog.householdTownship }}】，当前计划属于【{{ ownershipDialog.planTownship }}】。
          跨乡镇拖动安置户需权属确认，确认后该户纳入 {{ ownershipDialog.planTownship }} 的计划。
        </p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="confirmOwnership">确认纳入</button>
          <button class="btn ghost" type="button" @click="ownershipDialog = null">取消</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ households.length }} 户搬迁安置户 · {{ plans.length }} 个周计划</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="message" class="ok-text">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  BOARD_STATUSES,
  addHouseholdToPlan,
  confirmPlan,
  createPlan,
  currentWeek,
  deletePlan,
  isMissingLocation,
  listPlans,
  remainingDays,
  removeHouseholdFromPlan,
  supplementLocation,
  weekOptions,
} from '@/api/sandbox-service'
import { listRows } from '@/data/local-store'
import type { OwnershipConfirm } from '@/api/sandbox-service'
import type { WeeklyPlan } from '@/data/sandbox'
import type { EntryRow } from '@/data/types'

const households = ref<EntryRow[]>([])
const plans = ref<WeeklyPlan[]>([])
const selectedId = ref<number | null>(null)
const activePlanId = ref<number | null>(null)
const draggingId = ref<number | null>(null)
const ownershipDialog = ref<OwnershipConfirm | null>(null)
const supplementInputs = ref<Record<number, string>>({})
const message = ref('')
const errorMessage = ref('')

const weekChoices = weekOptions(8)
const newPlanWeek = ref(currentWeek())

const missingLocation = computed(() => households.value.filter(isMissingLocation))

const stats = computed(() => {
  const count = (status: string) => households.value.filter((row) => String(row.status) === status).length
  return [
    { label: '在册户数', value: households.value.length },
    { label: '待动员', value: count('待动员') },
    { label: '已签约', value: count('已签约') },
    { label: '已搬迁', value: count('已搬迁') },
    { label: '已安置', value: count('已安置') },
    { label: '待补录', value: missingLocation.value.length },
  ]
})

const zones = computed(() => {
  const groups = new Map<string, { name: string; township: string; rows: EntryRow[] }>()
  for (const row of households.value) {
    const name = String(row['所属隐患点'] ?? '') || '未登记隐患点'
    if (!groups.has(name)) {
      groups.set(name, { name, township: String(row['所在乡镇'] ?? ''), rows: [] })
    }
    groups.get(name)!.rows.push(row)
  }
  return [...groups.values()].map((group) => ({
    name: group.name,
    township: group.township,
    total: group.rows.length,
    columns: BOARD_STATUSES.map((status) => ({
      status,
      rows: group.rows.filter((row) => String(row.status) === status),
    })),
  }))
})

const selected = computed(() =>
  households.value.find((row) => Number(row.id) === selectedId.value) ?? null,
)

const householdMap = computed(() => new Map(households.value.map((row) => [Number(row.id), row])))

const activeDraft = computed(
  () => plans.value.find((plan) => plan.id === activePlanId.value && plan.status === '草稿') ?? null,
)

function isMissing(row: EntryRow): boolean {
  return isMissingLocation(row)
}

function remainingLabel(row: EntryRow): string {
  const days = remainingDays(row)
  if (days === null) {
    return '未设搬迁期限'
  }
  if (days < 0) {
    return `已逾期 ${-days} 天`
  }
  if (days === 0) {
    return '今天到期'
  }
  return `剩余 ${days} 天`
}

function remainingClass(row: EntryRow): string {
  const days = remainingDays(row)
  if (days === null) {
    return ''
  }
  if (days < 0) {
    return 'deadline-overdue'
  }
  if (days <= 3) {
    return 'deadline-urgent'
  }
  return ''
}

function planMembers(plan: WeeklyPlan): EntryRow[] {
  return plan.户Ids
    .map((id) => householdMap.value.get(id))
    .filter((row): row is EntryRow => Boolean(row))
}

function isCrossTownship(plan: WeeklyPlan, row: EntryRow): boolean {
  const township = String(row['所在乡镇'] ?? '')
  return Boolean(plan.所在乡镇 && township && township !== plan.所在乡镇)
}

function notify(result: { ok: boolean; message: string }) {
  if (result.ok) {
    message.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    message.value = ''
  }
}

function refreshPlans() {
  plans.value = listPlans().map((plan) => ({ ...plan, 户Ids: [...plan.户Ids] }))
  if (!plans.value.some((plan) => plan.id === activePlanId.value && plan.status === '草稿')) {
    activePlanId.value = plans.value.find((plan) => plan.status === '草稿')?.id ?? null
  }
}

function reload() {
  households.value = listRows('evacuation')
  refreshPlans()
}

function onDragStart(row: EntryRow, event: DragEvent) {
  const id = Number(row.id)
  draggingId.value = id
  event.dataTransfer?.setData('text/plain', String(id))
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onDropToPlan(plan: WeeklyPlan, event: DragEvent) {
  event.preventDefault()
  const raw = event.dataTransfer?.getData('text/plain') ?? ''
  const id = Number(raw) || draggingId.value
  draggingId.value = null
  if (!id) {
    return
  }
  activePlanId.value = plan.id
  addToPlan(plan.id, id, false)
}

function addToPlan(planId: number, householdId: number, ownershipConfirmed: boolean) {
  const result = addHouseholdToPlan(planId, householdId, ownershipConfirmed)
  if (result.needOwnershipConfirm) {
    ownershipDialog.value = result.needOwnershipConfirm
    return
  }
  notify(result)
  refreshPlans()
}

function addSelectedToActivePlan() {
  if (!selected.value || !activeDraft.value) {
    return
  }
  addToPlan(activeDraft.value.id, Number(selected.value.id), false)
}

function confirmOwnership() {
  const dialog = ownershipDialog.value
  ownershipDialog.value = null
  if (dialog) {
    addToPlan(dialog.planId, dialog.householdId, true)
  }
}

function removeFromPlan(plan: WeeklyPlan, row: EntryRow) {
  notify(removeHouseholdFromPlan(plan.id, Number(row.id)))
  refreshPlans()
}

function createNewPlan() {
  const result = createPlan(newPlanWeek.value)
  notify(result)
  if (result.ok && result.plan) {
    activePlanId.value = result.plan.id
  }
  refreshPlans()
}

function removePlan(plan: WeeklyPlan) {
  notify(deletePlan(plan.id))
  refreshPlans()
}

function confirm(plan: WeeklyPlan) {
  notify(confirmPlan(plan.id))
  refreshPlans()
}

function saveSupplement(row: EntryRow) {
  const id = Number(row.id)
  const result = supplementLocation(id, supplementInputs.value[id] ?? '')
  notify(result)
  if (result.ok) {
    supplementInputs.value[id] = ''
    reload()
  }
}

onMounted(reload)
</script>

<style scoped>
.stat-row {
  flex-wrap: wrap;
}
.missing-panel {
  background: #fff7ed;
  border: 1px solid #fdba74;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.missing-head {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  color: #9a3412;
  font-size: 13px;
}
.missing-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.missing-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}
.missing-label {
  min-width: 320px;
}
.missing-input {
  flex: 1;
  min-width: 220px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.sandbox-layout {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.sandbox-board {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.zone {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.zone-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}
.zone-meta {
  color: var(--muted);
  font-size: 12px;
}
.zone-columns {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.lane {
  background: #f8fafc;
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 6px;
  min-height: 120px;
}
.lane-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.lane-empty {
  color: #cbd5e1;
  font-size: 12px;
  text-align: center;
  margin: 18px 0;
}
.house-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
  cursor: grab;
  font-size: 12px;
}
.house-card.selected {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px var(--brand);
}
.house-card.missing {
  border-color: #fdba74;
  background: #fffbeb;
}
.house-head {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
}
.house-head span {
  color: var(--muted);
}
.house-line {
  margin: 2px 0 0;
  color: var(--muted);
}
.house-flag {
  margin: 2px 0 0;
  color: #b45309;
  font-weight: 600;
}
.deadline-urgent {
  color: #c2410c;
  font-weight: 600;
}
.deadline-overdue {
  color: #b42318;
  font-weight: 600;
}
.sandbox-side {
  width: 340px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.side-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.side-title {
  margin: 0 0 8px;
  font-size: 14px;
}
.side-hint {
  color: var(--muted);
  font-size: 12px;
  margin: 6px 0;
}
.detail-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.detail-list div {
  display: flex;
  gap: 8px;
}
.detail-list dt {
  width: 76px;
  color: var(--muted);
  flex-shrink: 0;
}
.detail-list dd {
  margin: 0;
}
.side-add {
  margin-top: 8px;
  width: 100%;
}
.plan-create {
  display: flex;
  gap: 8px;
}
.plan-week {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
}
.plan-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  margin-top: 8px;
  font-size: 13px;
}
.plan-card.active {
  border-color: var(--brand);
}
.plan-card.confirmed {
  background: #f0fdf4;
  border-color: #86efac;
}
.plan-head {
  display: flex;
  justify-content: space-between;
}
.plan-status {
  font-size: 12px;
  color: var(--muted);
}
.plan-meta {
  margin: 4px 0;
  color: var(--muted);
  font-size: 12px;
}
.plan-drop {
  border: 1px dashed var(--brand);
  border-radius: 6px;
  color: var(--brand);
  text-align: center;
  padding: 10px 6px;
  font-size: 12px;
  margin: 6px 0;
  background: #eff6ff;
}
.plan-drop.armed {
  background: #dbeafe;
}
.plan-members {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.plan-members li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.cross-tag {
  color: #7c3aed;
  font-style: normal;
  margin-left: 4px;
}
.missing-tag {
  color: #b45309;
  font-style: normal;
  margin-left: 4px;
}
.plan-foot {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.confirmed-foot {
  color: #15803d;
  font-size: 12px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 420px;
  max-width: 90vw;
}
.modal h3 {
  margin: 0 0 8px;
}
.modal p {
  font-size: 13px;
  color: #334155;
}
.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 12px;
}
.ok-text {
  color: #15803d;
}
</style>
