import { useState } from 'react';
import { AlertTriangle, ShieldAlert, CheckCircle2, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Field, TextInput } from '@/components/Field';
import { useToast } from '@/components/Toast';

const RESET_WORD = 'YES_RESET';

export default function ResetDataPage() {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const toast = useToast();

  const matched = confirm.trim().toUpperCase() === RESET_WORD;

  const run = async () => {
    if (!matched) return;
    setBusy(true);
    setError('');
    setDone(false);
    try {
      const res = await api('system', 'reset_operational_data', { method: 'POST' });
      setDone(true);
      toast('success', res.message || 'Reset berhasil.');
    } catch (e: any) {
      const msg = e.message || 'Reset gagal';
      setError(msg);
      toast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Reset Operational Data"
        subtitle="Bersihkan semua data transaksi & log (hanya admin)"
        actions={
          <button
            onClick={run}
            disabled={!matched || busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ShieldAlert className="w-4 h-4" /> {busy ? 'Merestart...' : 'Reset Data'}
          </button>
        }
      />

      {done && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Data operasional berhasil di-reset. Master data (produk, customer, lokasi, user) tetap aman.
        </div>
      )}

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <Card title="Perhatian — Aksi tidak dapat dibatalkan">
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50/60 p-3 text-sm text-red-800 flex items-start gap-2">
          <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Reset akan menghapus seluruh data transaksi: inbound, outbound, picklist, stock (termasuk stock_locations),
            stock take, bin transfer, stock ledger, dan activity log. Master data tetap aman.
          </span>
        </div>

        <p className="text-sm text-gray-600 mb-3">
          Ketik <code className="px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 font-mono text-xs font-bold text-red-600">{RESET_WORD}</code> untuk mengaktifkan tombol reset.
        </p>

        <Field label="Konfirmasi">
          <TextInput
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={RESET_WORD}
            className={matched ? '!border-emerald-400 !ring-emerald-500/15' : ''}
            autoCapitalize="characters"
            spellCheck={false}
          />
        </Field>

        <div className="mt-4 flex items-center gap-3 text-xs text-gray-400">
          Guard: admin only
        </div>
      </Card>
    </div>
  );
}