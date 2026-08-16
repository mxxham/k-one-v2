import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, XCircle, ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Spinner from '@/components/Spinner';
import ScanInput from '@/components/ScanInput';
import { TextInput } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';

interface MyTaskRow {
  id: number;
  lpn_code: string | null;
  product_code: string | null;
  product_name: string | null;
  batch_number: string | null;
  uom: string | null;
  pallet_seq: number;
  quantity: number;
  suggested_location: string | null;
  actual_location: string | null;
  status: string;
}

interface MyTask {
  id: number;
  task_number: string;
  order_number: string | null;
  status: string;
  forklift_operator_name: string | null;
  rows: MyTaskRow[];
}

type ScanStep = 'lpn' | 'bin' | 'confirm';
interface Mismatch {
  step: 'lpn' | 'bin';
  code: string;
}

/**
 * Mobile putaway confirmation for the checklist partner (Step 3 / S47–S48).
 * Scanner-first dual-scan: scan the pallet LPN, then scan the destination bin
 * barcode. Both must match the task's assigned values — a mismatch shows a red
 * error and can only be proceeded past with a typed override reason (logged to
 * activity_log, mirroring stock::scan_override). On match the pallet is
 * confirmed by reusing the EXISTING S42 task_complete_pallet action (who/when
 * labour tracking is already recorded there).
 *
 * Strict role split (user-confirmed): the partner confirms pallets here, but
 * completing the task (status → Completed, stock written) is done by the
 * inbound operator on the desktop Putaway Tasks screen — task_complete is
 * department-restricted to inbound/inventory/ops, so there is no finish button
 * on this mobile screen.
 */
export default function PutawayScanPage() {
  const toast = useToast();

  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [selected, setSelected] = useState<MyTask | null>(null);
  const [current, setCurrent] = useState<MyTaskRow | null>(null);
  const [step, setStep] = useState<ScanStep>('lpn');
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState<Mismatch | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [lastMatched, setLastMatched] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api('putaway', 'my_tasks');
      const list = (res.rows || []) as MyTask[];
      setTasks(list);
      if (selected) {
        const fresh = list.find((t) => t.id === selected.id) ?? null;
        setSelected(fresh);
        if (fresh) setCurrent(fresh.rows.find((r) => r.status !== 'Done') ?? null);
        else setCurrent(null);
      }
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat task saya');
    } finally {
      setLoading(false);
    }
  }, [toast, selected]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks, refreshKey]);

  const openTask = (task: MyTask) => {
    setSelected(task);
    setCurrent(task.rows.find((r) => r.status !== 'Done') ?? null);
    setStep('lpn');
    setMismatch(null);
    setOverrideReason('');
    setLastMatched(null);
  };

  const backToList = () => {
    setSelected(null);
    setCurrent(null);
    setStep('lpn');
    setMismatch(null);
    setRefreshKey((k) => k + 1);
  };

  const targetBin = (row: MyTaskRow) => (row.actual_location || row.suggested_location || '').trim().toUpperCase();

  const scanOverride = async (code: string) => {
    if (!overrideReason.trim()) return toast('error', 'Alasan override wajib diisi.');
    try {
      await api('putaway', 'scan_override', {
        body: { code, reason: overrideReason.trim(), context: `putaway:${selected?.task_number ?? ''}` },
      });
      toast('success', 'Override dicatat.');
      setMismatch(null);
      setOverrideReason('');
      return true;
    } catch (err: any) {
      toast('error', err.message || 'Gagal mencatat override');
      return false;
    }
  };

  const handleLpnScan = async (raw: string) => {
    if (!current || busy) return;
    const code = raw.trim().toUpperCase();
    const expected = (current.lpn_code || '').trim().toUpperCase();
    if (expected && code === expected) {
      setLastMatched('LPN cocok ✓');
      setStep('bin');
      return;
    }
    setMismatch({ step: 'lpn', code: raw });
    setStep('confirm');
  };

  const handleBinScan = async (raw: string) => {
    if (!current || busy) return;
    const code = raw.trim().toUpperCase();
    const expected = targetBin(current);
    if (expected && code === expected) {
      setLastMatched('Lokasi cocok ✓');
      await confirmPallet();
      return;
    }
    setMismatch({ step: 'bin', code: raw });
    setStep('confirm');
  };

  const handleMismatchContinue = async () => {
    if (!mismatch) return;
    const ok = await scanOverride(mismatch.code);
    if (!ok) return;
    if (mismatch.step === 'lpn') {
      setLastMatched('LPN di-override');
      setStep('bin');
    } else {
      setLastMatched('Lokasi di-override');
      await confirmPallet();
    }
  };

  const confirmPallet = async () => {
    if (!current || !selected || busy) return;
    try {
      setBusy(true);
      await api('putaway', 'task_complete_pallet', { body: { id: current.id } });
      toast('success', `Pallet #${current.pallet_seq} selesai.`);
      const nextRow = selected.rows.find((r) => r.status !== 'Done' && r.id !== current.id) ?? null;
      setCurrent(nextRow);
      setStep('lpn');
      setMismatch(null);
      setOverrideReason('');
      setLastMatched(null);
    } catch (err: any) {
      toast('error', err.message || 'Gagal konfirmasi pallet');
    } finally {
      setBusy(false);
    }
  };

  const doneCount = selected?.rows.filter((r) => r.status === 'Done').length ?? 0;

  return (
    <div className="max-w-md mx-auto">
      <PageHeader title="Putaway Saya" subtitle="Konfirmasi putaway dengan scan LPN lalu scan lokasi." />

      {!selected ? (
        <Card title="Task untuk checklist partner">
          {loading ? (
            <Spinner label="Memuat task…" />
          ) : tasks.length === 0 ? (
            <EmptyState message="Tidak ada putaway task yang ditugaskan ke Anda." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {tasks.map((t) => {
                const d = t.rows.filter((r) => r.status === 'Done').length;
                return (
                  <li key={t.id}>
                    <button onClick={() => openTask(t)} className="w-full text-left px-1 py-3 hover:bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-brand-700">{t.task_number}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Inbound {t.order_number || '—'}
                        {t.forklift_operator_name ? ` · Forklift: ${t.forklift_operator_name}` : ''}
                      </div>
                      <div className="text-xs mt-1">
                        <span className="font-semibold">
                          {d}/{t.rows.length}
                        </span>{' '}
                        <span className="text-gray-500">pallet selesai</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : (
        <Card
          title={`${selected.task_number} — pallet ${doneCount}/${selected.rows.length}`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button onClick={backToList} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-900">
              <ArrowLeft className="w-4 h-4" /> Daftar Task
            </button>
          </div>

          {!current ? (
            <div className="text-center py-6">
              <ClipboardList className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold">Semua pallet sudah dikonfirmasi.</p>
              <p className="text-xs text-gray-500 mt-1">
                Inbound operator akan menyelesaikan task (menulis stock) dari layar Putaway Tasks.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Pallet #{current.pallet_seq}</span>
                  <span className="font-mono text-xs font-semibold">{current.lpn_code || '—'}</span>
                </div>
                <div className="font-semibold text-sm mt-1">{current.product_name || current.product_code || '—'}</div>
                <div className="text-xs text-gray-500">{current.product_code || ''}</div>
                <div className="flex justify-between text-xs mt-1">
                  <span>
                    Qty: <span className="font-semibold">{fmtNum(current.quantity)} {current.uom || ''}</span>
                  </span>
                  <span>
                    Batch: <span className="font-semibold">{current.batch_number || '—'}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-sm">
                  <span className="text-gray-500 text-xs">Lokasi tujuan:</span>
                  <span className="font-bold text-brand-700">{targetBin(current)}</span>
                </div>
              </div>

              {lastMatched && (
                <div className="flex items-center gap-1.5 text-emerald-700 text-xs font-semibold bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-4 h-4" /> {lastMatched}
                </div>
              )}

              {step === 'lpn' && (
                <ScanInput onScan={handleLpnScan} placeholder="Scan LPN pallet…" className="mt-1" disabled={busy} />
              )}

              {step === 'bin' && (
                <ScanInput onScan={handleBinScan} placeholder="Scan barcode lokasi…" className="mt-1" disabled={busy} />
              )}

              {step === 'confirm' && mismatch && (
                <div className="rounded-xl border border-red-300 bg-red-50 p-3 space-y-2">
                  <div className="flex items-start gap-1.5 text-red-700 text-xs font-semibold">
                    <XCircle className="w-4 h-4 mt-0.5" />
                    <span>
                      Scan{' '}
                      <span className="font-mono bg-white px-1 rounded">'{mismatch.code}'</span> tidak cocok dengan{' '}
                      {mismatch.step === 'lpn' ? `LPN '${current.lpn_code}'` : `lokasi '${targetBin(current)}'`}.
                    </span>
                  </div>
                  <TextInput
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Alasan override…"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleMismatchContinue}
                      disabled={busy}
                      className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                    >
                      Override & Lanjut
                    </button>
                    <button
                      onClick={() => setMismatch(null)}
                      className="px-3 py-1.5 rounded-lg bg-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-300"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}