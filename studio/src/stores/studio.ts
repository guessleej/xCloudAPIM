import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { nanoid } from '../utils/nanoid.ts'
import type { PolicyDef, PolicyPhase, PolicyType, PolicyChain, APIInfo } from '../types/policy.ts'
import { PLUGIN_REGISTRY } from '../types/policy.ts'

interface StudioState {
  // 當前編輯的 API
  api:      APIInfo | null
  chain:    PolicyChain | null
  isDirty:  boolean
  isSaving: boolean

  // 選中的 policy
  selectedPolicyId: string | null

  // Actions
  loadChain:        (api: APIInfo, chain: PolicyChain | null) => void
  addPolicy:        (type: PolicyType, phase: PolicyPhase) => void
  removePolicy:     (id: string) => void
  updatePolicy:     (id: string, partial: Partial<Pick<PolicyDef, 'enabled' | 'config' | 'condition'>>) => void
  reorderPolicies:  (phase: PolicyPhase, orderedIds: string[]) => void
  movePolicy:       (id: string, newPhase: PolicyPhase) => void
  selectPolicy:     (id: string | null) => void
  setSaving:        (v: boolean) => void
  markClean:        (chain: PolicyChain) => void
}

export const useStudioStore = create<StudioState>()(
  immer((set) => ({
    api:              null,
    chain:            null,
    isDirty:          false,
    isSaving:         false,
    selectedPolicyId: null,

    loadChain: (api, chain) => set((s) => {
      s.api             = api
      s.chain           = chain
      s.isDirty         = false
      s.selectedPolicyId = null
    }),

    addPolicy: (type, phase) => set((s) => {
      const meta = PLUGIN_REGISTRY.find((p) => p.type === type)
      if (!meta) return
      const existing = s.chain?.policies.filter((p) => p.phase === phase) ?? []
      const newPolicy: PolicyDef = {
        id:            nanoid(),
        type,
        phase,
        order:         existing.length,
        enabled:       true,
        config:        { ...meta.defaultConfig },
      }
      if (!s.chain) {
        s.chain = {
          chainId: '', apiId: s.api?.id ?? '', version: 0,
          etag: '', updatedAt: null, policies: [],
        }
      }
      s.chain.policies.push(newPolicy)
      s.selectedPolicyId = newPolicy.id
      s.isDirty = true
    }),

    removePolicy: (id) => set((s) => {
      if (!s.chain) return
      s.chain.policies = s.chain.policies.filter((p) => p.id !== id)
      if (s.selectedPolicyId === id) s.selectedPolicyId = null
      s.isDirty = true
    }),

    updatePolicy: (id, partial) => set((s) => {
      const p = s.chain?.policies.find((p) => p.id === id)
      if (!p) return
      if (partial.enabled !== undefined) p.enabled = partial.enabled
      if (partial.config   !== undefined) p.config  = { ...p.config, ...partial.config }
      if (partial.condition !== undefined) p.condition = partial.condition
      s.isDirty = true
    }),

    reorderPolicies: (phase, orderedIds) => set((s) => {
      if (!s.chain) return
      orderedIds.forEach((id, idx) => {
        const p = s.chain!.policies.find((p) => p.id === id)
        if (p && p.phase === phase) p.order = idx
      })
      s.isDirty = true
    }),

    movePolicy: (id, newPhase) => set((s) => {
      const p = s.chain?.policies.find((p) => p.id === id)
      if (!p) return
      const existing = s.chain!.policies.filter((q) => q.phase === newPhase)
      p.phase = newPhase
      p.order = existing.length
      s.isDirty = true
    }),

    selectPolicy: (id) => set((s) => { s.selectedPolicyId = id }),

    setSaving: (v) => set((s) => { s.isSaving = v }),

    markClean: (chain) => set((s) => {
      s.chain   = chain
      s.isDirty = false
    }),
  })),
)

// ─── Selector helpers ─────────────────────────────────────────

export const selectPoliciesByPhase = (state: StudioState, phase: PolicyPhase) =>
  (state.chain?.policies ?? [])
    .filter((p) => p.phase === phase)
    .sort((a, b) => a.order - b.order)

export const selectSelectedPolicy = (state: StudioState) =>
  state.chain?.policies.find((p) => p.id === state.selectedPolicyId) ?? null
