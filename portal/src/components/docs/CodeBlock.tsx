'use client'
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  code:       string
  language?:  string
  title?:     string
  className?: string
}

/**
 * Minimal syntax-highlighted code block.
 * Uses CSS classes to colour common token patterns — no runtime library needed.
 */
export default function CodeBlock({ code, language = 'bash', title, className }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={clsx('rounded-xl overflow-hidden border border-gray-800 bg-gray-950', className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <span className="w-3 h-3 rounded-full bg-green-500/70" />
          </div>
          {title && (
            <span className="text-xs text-gray-400 ml-2 font-mono">{title}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 font-mono uppercase">{language}</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-800"
          >
            {copied
              ? <><Check size={11} className="text-green-400" /> 已複製</>
              : <><Copy size={11} /> 複製</>}
          </button>
        </div>
      </div>

      {/* Code */}
      <pre className="overflow-x-auto px-5 py-4 text-sm leading-relaxed font-mono">
        <Highlight code={code} language={language} />
      </pre>
    </div>
  )
}

// ─── Token highlighter ────────────────────────────────────────

function Highlight({ code, language }: { code: string; language: string }) {
  if (language === 'bash' || language === 'shell') return <BashHighlight code={code} />
  if (language === 'json')                          return <JsonHighlight  code={code} />
  return <span className="text-gray-200">{code}</span>
}

function BashHighlight({ code }: { code: string }) {
  const lines = code.split('\n')
  return (
    <>
      {lines.map((line, i) => {
        // Comments
        if (line.trimStart().startsWith('#')) {
          return <div key={i} className="text-gray-500">{line}</div>
        }
        // Continuation lines (starting with spaces or tabs after \)
        if (line.startsWith('  ') || line.startsWith('\t')) {
          return (
            <div key={i}>
              {tokeniseBashLine(line)}
            </div>
          )
        }
        return <div key={i}>{tokeniseBashLine(line)}</div>
      })}
    </>
  )
}

function tokeniseBashLine(line: string) {
  // Very lightweight: colour strings, flags, and keywords
  const parts: React.ReactNode[] = []
  let rest = line

  const patterns: Array<{ re: RegExp; cls: string }> = [
    { re: /^(curl|export|echo|python3?|node|go)\b/, cls: 'text-blue-400 font-semibold' },
    { re: /^(-[a-zA-Z]+|--[a-zA-Z-]+)\s/,          cls: 'text-yellow-300' },
    { re: /^"[^"]*"/,                               cls: 'text-green-300' },
    { re: /^'[^']*'/,                               cls: 'text-green-300' },
    { re: /^https?:\/\/\S+/,                        cls: 'text-cyan-300' },
    { re: /^\\\s*$/,                                cls: 'text-gray-500' },
  ]

  let safety = 0
  while (rest.length > 0 && safety++ < 500) {
    let matched = false
    for (const { re, cls } of patterns) {
      const m = rest.match(re)
      if (m) {
        parts.push(<span key={parts.length} className={cls}>{m[0]}</span>)
        rest = rest.slice(m[0].length)
        matched = true
        break
      }
    }
    if (!matched) {
      // Consume one character as plain text
      const next = rest[0]
      const last = parts[parts.length - 1]
      if (typeof last === 'string') {
        parts[parts.length - 1] = last + next
      } else {
        parts.push(next)
      }
      rest = rest.slice(1)
    }
  }

  return <span className="text-gray-200">{parts}</span>
}

function JsonHighlight({ code }: { code: string }) {
  // Replace JSON tokens with coloured spans
  const html = code
    .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="text-blue-300">$1</span>$2')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="text-green-300">$1</span>')
    .replace(/:\s*(true|false|null)\b/g, ': <span class="text-yellow-300">$1</span>')
    .replace(/:\s*(-?\d+(?:\.\d+)?)/g, ': <span class="text-purple-300">$1</span>')

  return (
    <span
      className="text-gray-200"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
