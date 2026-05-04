/**
 * Policy Chain Canvas（React Flow）
 *
 * 佈局：4 個 Phase 垂直欄，每欄包含該 Phase 的 PolicyNode
 * 欄寬 280px，節點間距 16px，欄間距 48px
 * 不使用 Edge（policies 靠垂直順序表達執行順序）
 */
import { useCallback, useEffect } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, type Node, type Edge,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStudioStore, selectPoliciesByPhase } from '../../stores/studio.ts'
import {
  PHASE_ORDER, PHASE_LABELS, PHASE_COLORS, type PolicyPhase,
} from '../../types/policy.ts'
import PolicyNode, { type PolicyNodeData } from './PolicyNode.tsx'

const nodeTypes = { policy: PolicyNode }

const COLUMN_WIDTH  = 280
const COLUMN_GAP    = 64
const NODE_HEIGHT   = 112
const NODE_GAP      = 12
const HEADER_Y      = 60
const NODE_START_Y  = HEADER_Y + 48

function buildNodes(
  getPhase: (ph: PolicyPhase) => ReturnType<typeof selectPoliciesByPhase>,
  selectedId: string | null,
): Node<PolicyNodeData>[] {
  const nodes: Node<PolicyNodeData>[] = []

  PHASE_ORDER.forEach((phase, colIdx) => {
    const x = colIdx * (COLUMN_WIDTH + COLUMN_GAP) + 24

    // Phase header node
    nodes.push({
      id:       `phase-${phase}`,
      type:     'default',
      position: { x, y: HEADER_Y },
      data:     { label: buildPhaseLabel(phase) } as unknown as PolicyNodeData,
      draggable: false,
      selectable: false,
      style: {
        width: COLUMN_WIDTH,
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
        pointerEvents: 'none',
      },
    })

    // Policy nodes
    const policies = getPhase(phase)
    policies.forEach((policy, rowIdx) => {
      nodes.push({
        id:       policy.id,
        type:     'policy',
        position: { x, y: NODE_START_Y + rowIdx * (NODE_HEIGHT + NODE_GAP) },
        data:     { policy },
        selected: policy.id === selectedId,
        draggable: false,
        style: { width: COLUMN_WIDTH },
      })
    })

    // Drop zone (placeholder)
    if (policies.length === 0) {
      nodes.push({
        id:       `empty-${phase}`,
        type:     'default',
        position: { x, y: NODE_START_Y },
        data:     { label: buildEmptyLabel() } as unknown as PolicyNodeData,
        draggable: false,
        selectable: false,
        style: {
          width: COLUMN_WIDTH,
          height: 80,
          background: 'transparent',
          border: '2px dashed #cbd5e1',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: '12px',
        },
      })
    }
  })

  return nodes
}

function buildPhaseLabel(phase: PolicyPhase): JSX.Element {
  return (
    <div className={`w-full px-3 py-1.5 rounded-lg border text-center text-xs font-semibold ${PHASE_COLORS[phase]}`}>
      {PHASE_LABELS[phase]}
    </div>
  ) as unknown as JSX.Element
}

function buildEmptyLabel(): JSX.Element {
  return <span>從左側拖曳政策到此處</span> as unknown as JSX.Element
}

export default function PolicyCanvas() {
  const state = useStudioStore()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<PolicyNodeData>>([])
  const [edges, , onEdgesChange] = useEdgesState<Edge>([])

  const rebuild = useCallback(() => {
    const newNodes = buildNodes(
      (ph) => selectPoliciesByPhase(state, ph),
      state.selectedPolicyId,
    )
    setNodes(newNodes)
  }, [state, setNodes])

  useEffect(() => { rebuild() }, [state.chain, state.selectedPolicyId, rebuild])

  // Canvas 空白處點選 → 取消選中
  const onPaneClick = useCallback(() => {
    state.selectPolicy(null)
  }, [state])

  const canvasWidth = PHASE_ORDER.length * (COLUMN_WIDTH + COLUMN_GAP) + 24

  return (
    <div
      style={{ width: '100%', height: '100%' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const type = e.dataTransfer.getData('policy-type') as import('../../types/policy.ts').PolicyType
        const phase = e.dataTransfer.getData('policy-phase') as PolicyPhase
        if (type && phase) state.addPolicy(type, phase)
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.4}
        maxZoom={1.5}
        deleteKeyCode={null}
        style={{ background: '#f8fafc' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#e2e8f0" />
        <Controls position="bottom-right" />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={(n) => {
            if (n.id.startsWith('phase-') || n.id.startsWith('empty-')) return '#f1f5f9'
            return '#bfdbfe'
          }}
          pannable
          zoomable
          position="bottom-left"
          style={{ background: 'white', border: '1px solid #e2e8f0' }}
        />
        {/* Phase column guidelines */}
        <svg
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', width: canvasWidth, height: '100%' }}
        >
          {PHASE_ORDER.map((_, i) => (
            <rect
              key={i}
              x={i * (COLUMN_WIDTH + COLUMN_GAP) + 24 - 8}
              y={0}
              width={COLUMN_WIDTH + 16}
              height="100%"
              fill="transparent"
              stroke="#e2e8f0"
              strokeWidth={1}
              rx={12}
            />
          ))}
        </svg>
      </ReactFlow>
    </div>
  )
}
