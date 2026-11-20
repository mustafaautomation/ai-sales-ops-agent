'use client'

import { useState } from 'react'
import { maskPayloadSecrets } from '@meridian/core'
import { decide } from '../app/(desk)/actions'
import { pretty } from '../lib/format'

function lineDiff(before: string, after: string) {
  const a = before.split('\n')
  const b = after.split('\n')
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: { type: 'same' | 'add' | 'del'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: a[i] })
      i += 1
    } else {
      rows.push({ type: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < a.length) rows.push({ type: 'del', text: a[i++] })
  while (j < b.length) rows.push({ type: 'add', text: b[j++] })
  return rows
}

export function ApprovalEditor({ id, proposed }: { id: string; proposed: string }) {
  const initial = maskPayloadSecrets(pretty(proposed))
  const [text, setText] = useState(initial)
  const dirty = text.trim() !== initial.trim()
  const diff = dirty ? lineDiff(initial, text) : []
  return (
    <form action={decide} className="stack">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="proposedJson" value={proposed} />
      <details className="payload">
        <summary>Raw payload</summary>
        <label className="skip" htmlFor="payload">Payload the desk will run</label>
        <textarea id="payload" name="finalJson" rows={16} spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} />
      </details>
      {dirty ? (
        <div className="diff" aria-label="Edit diff">
          {diff.map((row, index) => (
            <div key={`${row.type}-${index}`} className={row.type === 'same' ? undefined : row.type}>
              {row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : '  '}
              {row.text}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No edits. Approving runs this payload as proposed.</p>
      )}
      <div className="row-actions">
        <button className="btn primary" name="decision" value="approved" type="submit">
          {dirty ? 'Approve edits' : 'Approve'}
        </button>
        <button className="btn danger" name="decision" value="rejected" type="submit">
          Reject
        </button>
      </div>
    </form>
  )
}
