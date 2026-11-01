import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'
import { toast } from 'react-toastify'
import { backendUrl } from '../App'
import { formatPaise } from '../utils/refunds'
import {
  ANOMALY_STATUS_LABELS,
  anomalyActions,
  anomalyKindLabel,
  lastRunSummary,
  seenAgainAfterResolution,
  summarizeRun,
  validateReason
} from '../utils/paymentExceptions'

const when = value => value ? new Date(value).toLocaleString('en-IN') : '—'

const RunRow = ({ run }) => {
  const s = summarizeRun(run)
  return (
    <li className='border p-2'>
      <p>{when(s.startedAt)} · {s.trigger} · <span className='font-medium'>{s.outcome}</span></p>
      <p>Examined {s.examined} · Settled {s.settled} · Mismatches {s.mismatches} · Needs review {s.needsReview} · Gateway errors {s.gatewayErrors}</p>
      {s.rateLimited && <p className='text-amber-900'>Stopped because Razorpay rate-limited the run.</p>}
      {!s.rateLimited && s.stoppedEarly && <p className='text-amber-900'>Stopped early: {s.abortReason}</p>}
    </li>
  )
}
RunRow.propTypes = { run: PropTypes.object.isRequired }

const AnomalyRow = ({ anomaly, token, onChanged }) => {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const change = async status => {
    if (busy) return
    const checked = validateReason(reason)
    if (checked.error) { toast.error(checked.error); return }
    setBusy(true)
    try {
      await axios.post(`${backendUrl}/api/order/anomalies/status`,
        { anomalyId: anomaly.id, status, reason: checked.reason }, { headers: { token } })
      setReason('')
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not update the anomaly.')
    } finally {
      setBusy(false)
      await onChanged()
    }
  }
  return (
    <li className='border p-3'>
      <p className='font-medium'>{anomalyKindLabel(anomaly.kind)} · {ANOMALY_STATUS_LABELS[anomaly.investigationStatus] || anomaly.investigationStatus}</p>
      <p>Anomaly ID : {anomaly.id}</p>
      <p>Order : {anomaly.orderId || 'not linked'} · Razorpay order : {anomaly.razorpayOrderId || '—'}</p>
      <p>Payment : {anomaly.paymentId || '—'}{anomaly.refundId ? ` · Refund : ${anomaly.refundId}` : ''}{anomaly.eventId ? ` · Event : ${anomaly.eventId}` : ''}</p>
      <p>Amount : {anomaly.amountPaise === null ? 'unknown' : formatPaise(anomaly.amountPaise)} {anomaly.currency}</p>
      <p>Detected : {when(anomaly.firstSeenAt)} · last seen {when(anomaly.lastSeenAt)} · seen {anomaly.seenCount}×</p>
      {seenAgainAfterResolution(anomaly) && <p className='text-amber-900'>Seen again after it was resolved.</p>}
      {anomaly.resolution && <p>Resolution note : {anomaly.resolution}</p>}
      {anomaly.history.length > 0 && (
        <details>
          <summary className='cursor-pointer'>Audit history ({anomaly.history.length})</summary>
          <ul>{anomaly.history.map((entry, index) => (
            <li key={index}>{when(entry.at)} · {entry.actor}: {entry.from} → {entry.to} · {entry.reason}</li>
          ))}</ul>
        </details>
      )}
      <div className='mt-2 grid gap-2 sm:grid-cols-[1fr_auto]'>
        <input aria-label='Reason' placeholder='Reason (5–120 characters)' value={reason} maxLength={120}
          onChange={event => setReason(event.target.value)} className='border p-2' />
        <div className='flex flex-wrap gap-2'>
          {anomalyActions(anomaly).map(action => (
            <button key={action.status} type='button' disabled={busy} onClick={() => change(action.status)}
              className='min-h-10 border px-3 py-2 disabled:opacity-50'>{action.label}</button>
          ))}
        </div>
      </div>
      <p className='mt-1 text-stone-600'>Changing the investigation status never changes payment, stock or fulfilment.</p>
    </li>
  )
}
AnomalyRow.propTypes = { anomaly: PropTypes.object.isRequired, token: PropTypes.string.isRequired, onChanged: PropTypes.func.isRequired }

const PaymentExceptions = ({ token }) => {
  const [runs, setRuns] = useState([])
  const [anomalies, setAnomalies] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [filter, setFilter] = useState('open')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const runLock = useRef(false)

  const load = useCallback(async () => {
    try {
      const [history, list] = await Promise.all([
        axios.post(`${backendUrl}/api/order/reconcile/history`, {}, { headers: { token } }),
        axios.post(`${backendUrl}/api/order/anomalies`, { status: filter }, { headers: { token } })
      ])
      setRuns(history.data.runs || [])
      setAnomalies(list.data.anomalies || [])
      setHasMore(Boolean(list.data.hasMore))
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load payment exceptions.')
    } finally {
      setLoading(false)
    }
  }, [token, filter])

  useEffect(() => { load() }, [load])

  const loadMore = async () => {
    const last = anomalies[anomalies.length - 1]
    if (!last) return
    try {
      const list = await axios.post(`${backendUrl}/api/order/anomalies`,
        { status: filter, before: last.lastSeenAt }, { headers: { token } })
      setAnomalies(current => [...current, ...(list.data.anomalies || [])])
      setHasMore(Boolean(list.data.hasMore))
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load more anomalies.')
    }
  }

  const runReconciliation = async () => {
    if (runLock.current) return
    runLock.current = true
    setRunning(true)
    try {
      await axios.post(`${backendUrl}/api/order/reconcile`, {}, { headers: { token } })
    } catch (error) {
      toast.error(error.response?.data?.message || 'Reconciliation failed.')
    } finally {
      await load()
      runLock.current = false
      setRunning(false)
    }
  }

  const last = lastRunSummary(runs)

  return (
    <div>
      <h3>Payment exceptions</h3>
      <section className='my-4 border p-3 text-sm' aria-label='Reconciliation history'>
        <p className='font-medium'>Reconciliation</p>
        <button type='button' onClick={runReconciliation} disabled={running}
          className='mt-2 min-h-10 border px-4 py-2 disabled:opacity-50'>
          {running ? 'Reconciling…' : 'Run reconciliation now'}
        </button>
        <p className='mt-2 text-stone-600'>
          Runs only when started here or by an external job. No automatic scheduler is configured.
        </p>
        {last
          ? <p className='mt-2'>Last attempt : {when(last.startedAt)} · outcome : {last.outcome}</p>
          : !loading && <p className='mt-2 text-stone-500'>No reconciliation runs recorded yet.</p>}
        <ul className='mt-2 grid gap-2'>{runs.map(run => <RunRow key={run.id} run={run} />)}</ul>
      </section>

      <section className='text-sm' aria-label='Payment anomalies'>
        <label className='flex items-center gap-2'>Show
          <select value={filter} onChange={event => setFilter(event.target.value)} className='border p-2'>
            <option value='open'>Open</option>
            <option value='investigating'>Under investigation</option>
            <option value='resolved'>Resolved</option>
            <option value='all'>All</option>
          </select>
        </label>
        {loading && <p className='py-4'>Loading…</p>}
        {!loading && anomalies.length === 0 && <p className='py-6 text-center'>No anomalies in this view.</p>}
        <ul className='mt-3 grid gap-3'>
          {anomalies.map(anomaly => <AnomalyRow key={anomaly.id} anomaly={anomaly} token={token} onChanged={load} />)}
        </ul>
        {hasMore && <button type='button' onClick={loadMore} className='mt-3 min-h-10 border px-4 py-2'>Load more</button>}
      </section>
    </div>
  )
}

PaymentExceptions.propTypes = { token: PropTypes.string.isRequired }

export default PaymentExceptions
