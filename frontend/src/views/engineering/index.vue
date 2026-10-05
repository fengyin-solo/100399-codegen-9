<template>
  <section class="page" data-module="engineering">
    <header class="page-head">
      <div>
        <h2>治理工程管理</h2>
        <p class="page-desc">维护治理工程项目，围绕项目编号、隐患点编号、治理方案、承建方做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记治理工程项目</button>
        <button class="btn" type="button" @click="exportRows">导出治理工程清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="notice-panel">
      <header class="notice-head">
        <h3>场地核验通知</h3>
        <span class="notice-desc">
          来自避险搬迁安置沙盘：周计划确认后自动生成，共 {{ notices.length }} 条，待核验 {{ pendingNoticeCount }} 条。
        </span>
      </header>
      <table v-if="notices.length" class="data-table">
        <thead>
          <tr>
            <th>通知编号</th>
            <th>关联计划</th>
            <th>户号</th>
            <th>户主</th>
            <th>所属隐患点</th>
            <th>所在乡镇</th>
            <th>安置地点</th>
            <th>生成时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="notice in notices" :key="notice.id">
            <td>{{ notice.通知编号 }}</td>
            <td>{{ notice.计划编号 }}</td>
            <td>{{ notice.户号 }}</td>
            <td>{{ notice.户主姓名 }}</td>
            <td>{{ notice.所属隐患点 }}</td>
            <td>{{ notice.所在乡镇 }}</td>
            <td>{{ notice.安置地点 }}</td>
            <td>{{ notice.生成时间 }}</td>
            <td>{{ notice.status }}</td>
            <td>
              <button
                v-if="notice.status === '待核验'"
                class="link"
                type="button"
                @click="complete(notice)"
              >
                完成核验
              </button>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="notice-empty">暂无场地核验通知，安置沙盘确认周计划后会出现在这里。</p>
      <p v-if="noticeMessage" class="notice-message">{{ noticeMessage }}</p>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无治理工程数据，可先登记治理工程项目</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条治理工程记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { completeNotice, listNotices } from '@/api/sandbox-service'
import type { SiteNotice } from '@/data/sandbox'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('engineering')
const columns = ["项目编号", "隐患点编号", "治理方案", "承建方", "合同金额", "开工日期", "计划工期", "项目状态"]
const actions = ["启动招标", "开工确认", "申请验收"]
const statuses = ["待立项", "招标中", "施工中", "已竣工", "待验收"]
const stats = [{"label": "项目总数", "value": 0}, {"label": "施工中数", "value": 0}, {"label": "待验收数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const notices = ref<SiteNotice[]>([])
const noticeMessage = ref('')
const pendingNoticeCount = computed(
  () => notices.value.filter((notice) => notice.status === '待核验').length,
)
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '治理工程项目登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '治理工程列表读取失败'
  }
}

function reloadNotices() {
  notices.value = listNotices().map((notice) => ({ ...notice }))
}

function complete(notice: SiteNotice) {
  const result = completeNotice(notice.id)
  noticeMessage.value = result.message
  reloadNotices()
}

onMounted(() => {
  reload()
  reloadNotices()
})
</script>

<style scoped>
.notice-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.notice-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.notice-head h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.notice-desc {
  color: var(--muted);
  font-size: 12px;
}
.notice-empty {
  color: var(--muted);
  font-size: 13px;
  margin: 6px 0 2px;
}
.notice-message {
  color: #15803d;
  font-size: 12px;
  margin: 6px 0 0;
}
</style>
