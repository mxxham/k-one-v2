import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCheck, PackageCheck, RefreshCw, Save, Printer, AlertTriangle } from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { fmtDate, fmtDateTime, fmtNum } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';

import Spinner from '@/components/Spinner';
import ConfirmButton from '@/components/ConfirmButton';
import { Select, TextInput } from '@/components/Field';
import ScanInput from '@/components/ScanInput';

interface PicklistItem {
  id: number;
  product_code?: string;
  product_name?: string;
  batch_no?: string;
  batch_number?: string;
  location?: string;
  quantity?: number;
  uom?: string;
  pallet?: string | number | null;
  picked_quantity?: number;
  status?: string;
  picked_at?: string;
  picker_id?: string;
  notes?: string;
}

interface PicklistDetail {
  id: number;
  picklist_number?: string;
  status?: string;
  created_date?: string;
  outbound_order_id?: number | null;
  outbound_number?: string | null;
  wave_id?: number | null;
  wave_number?: string | null;
  wave_carrier?: string | null;
  notes?: string;
  created_by_name?: string;
  confirmed_at?: string;
  picked_at?: string;
  completed_at?: string;
}

const ITEM_STATUSES = ['Pending', 'Picked', 'Verified'];

export default function PicklistDetail() {
  const { id } = useParams<{ id: string }>();
  const { canWrite } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [picklist, setPicklist] = useState<PicklistDetail | null>(null);
  const [items, setItems] = useState<PicklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<number, { qty: string; status: string }>>({});
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('picklist', 'detail', { params: { id } });
      setPicklist(res.picklist || null);
      const list = res.items || [];
      setItems(list);
      const map: Record<number, { qty: string; status: string }> = {};
      list.forEach((it: PicklistItem) => {
        map[it.id] = {
          qty: it.picked_quantity != null ? String(it.picked_quantity) : '',
          status: it.status || 'Pending',
        };
      });
      setEdits(map);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat detail picklist');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: string, body: Record<string, any>, successMsg: string) => {
    setBusy(true);
    try {
      await api('picklist', action, { body: { id, ...body } });
      toast('success', successMsg);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Operasi gagal');
    } finally {
      setBusy(false);
    }
  };

  const handleStatusAction = (action: string, msg: string) => {
    if (busy) return;
    run(action, {}, msg);
  };

  const handleDelete = async () => {
    try {
      await api('picklist', 'delete', { body: { id } });
      toast('success', 'Picklist dihapus');
      navigate('/picklist');
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus picklist');
    }
  };

  const handleUpdateItem = async (item: PicklistItem) => {
    const e = edits[item.id] || { qty: '', status: 'Pending' };
    try {
      await api('picklist', 'update_item', {
        body: {
          item_id: item.id,
          picked_quantity: e.qty === '' ? undefined : Number(e.qty),
          status: e.status,
        },
      });
      toast('success', 'Item diperbarui');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal memperbarui item');
    }
  };

  // Phase 2 — scanner-first picking: a matching scan auto-confirms the next
  // Pending item (full qty + status Picked). Mismatch requires an explicit
  // override with a reason logged to activity_log (stock::scan_override).
  const nextPending = items.find((it) => it.status === 'Pending');

  const autoConfirm = async (item: PicklistItem) => {
    try {
      await api('picklist', 'update_item', {
        body: {
          item_id: item.id,
          picked_quantity: Number(item.quantity ?? 0),
          status: 'Picked',
        },
      });
      toast('success', `${item.product_code || item.id} dikonfirmasi (${fmtNum(item.quantity, 0)} ${item.uom || ''})`);
      setScanErr(null);
      setOverrideReason('');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal mengonfirmasi item');
    }
  };

  const handleScan = async (code: string) => {
    setScanErr(null);
    setOverrideReason('');
    if (!nextPending) {
      setScanErr('Tidak ada item Pending untuk dikonfirmasi.');
      return;
    }
    let res: any;
    try {
      res = await api('stock', 'scan', { params: { code } });
    } catch (err: any) {
      setScanErr(err.message || 'Gagal membaca kode');
      return;
    }
    if (!res?.found) {
      setScanErr(`Kode '${code}' tidak dikenali (product tidak ditemukan).`);
      return;
    }
    const scannedCode = res.product?.product_code || code;
    const expectedCode = nextPending.product_code || '';
    if (expectedCode && scannedCode === expectedCode) {
      await autoConfirm(nextPending);
    } else {
      setScanCode(code);
      setScanErr(
        `Kode '${scannedCode}' TIDAK sesuai item berikutnya '${expectedCode || '—'}' ` +
        `(${nextPending.product_name || ''}). Isi alasan untuk override.`,
      );
    }
  };

  const handleOverride = async () => {
    if (!overrideReason.trim()) {
      toast('error', 'Alasan override wajib diisi');
      return;
    }
    try {
      await api('stock', 'scan_override', {
        method: 'POST',
        body: { code: scanCode, reason: overrideReason.trim(), context: `picklist:${picklist?.picklist_number || picklist?.id}` },
      });
      await autoConfirm(nextPending!);
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan override');
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Picklist" />
        <Spinner label="Loading detail…" />
      </div>
    );
  }

  if (!picklist) {
    return (
      <div>
        <PageHeader title="Picklist" />
        <Card>
          <EmptyState message="Picklist tidak ditemukan" />
        </Card>
      </div>
    );
  }

  const status = picklist.status || '';

  const actions = (
    <>
      <button
        onClick={() => navigate('/picklist')}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
      >
        <ArrowLeft className="w-4 h-4" /> Kembali
      </button>
      {canWrite && status === 'Draft' && (
        <button
          disabled={busy}
          onClick={() => handleStatusAction('confirm', 'Picklist dikonfirmasi')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 hover:bg-brand-50 text-sm font-semibold disabled:opacity-60"
        >
          <CheckCheck className="w-4 h-4" /> Confirm
        </button>
      )}
      {canWrite && (status === 'Confirmed' || status === 'Picking') && (
        <button
          disabled={busy}
          onClick={() => handleStatusAction('complete', 'Picklist diselesaikan')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-brand-700 hover:bg-brand-50 text-sm font-semibold disabled:opacity-60"
        >
          <PackageCheck className="w-4 h-4" /> Complete
        </button>
      )}
      {canWrite && (
        <ConfirmButton label="Hapus" confirmText={`Hapus picklist ${picklist.picklist_number || ''}?`} onConfirm={handleDelete} />
      )}
      <WebBtn
        href={apiHref('print', 'picklist', { id: picklist.id })}
        label="Print"
        icon={<Printer className="w-4 h-4" />}
      />
      <button
        onClick={load}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
      >
        <RefreshCw className="w-4 h-4" /> Refresh
      </button>
    </>
  );

  return (
    <div>
      <PageHeader
        title={`${picklist.picklist_number || `Picklist #${picklist.id}`} `}
        subtitle={`Status: ${status}`}
        actions={actions}
      />

      <Card title="Informasi">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Status</div>
            <StatusBadge status={status} />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Created Date</div>
            <div className="text-sm font-medium text-gray-800">{fmtDateTime(picklist.created_date)}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">{picklist.wave_id ? 'Wave' : 'Outbound'}</div>
            {picklist.wave_id ? (
              <Link to={`/waves`} className="text-sm font-medium text-brand-600 hover:underline">
                {picklist.wave_number || `Wave #${picklist.wave_id}`}
              </Link>
            ) : picklist.outbound_order_id ? (
              <Link to={`/outbound/${picklist.outbound_order_id}`} className="text-sm font-medium text-brand-600 hover:underline">
                {picklist.outbound_number || `#${picklist.outbound_order_id}`}
              </Link>
            ) : (
              <div className="text-sm text-gray-500">—</div>
            )}
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Created By</div>
            <div className="text-sm font-medium text-gray-800">{picklist.created_by_name || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Confirmed At</div>
            <div className="text-sm text-gray-800">{fmtDateTime(picklist.confirmed_at)}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Picked At</div>
            <div className="text-sm text-gray-800">{fmtDateTime(picklist.picked_at)}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Completed At</div>
            <div className="text-sm text-gray-800">{fmtDateTime(picklist.completed_at)}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Notes</div>
            <div className="text-sm text-gray-800">{picklist.notes || '—'}</div>
          </div>
        </div>
      </Card>

      <Card title="Items">
        {canWrite && (
          <div className="px-4 pt-3">
            <ScanInput onScan={handleScan} placeholder={`Scan SKU → konfirmasi item berikutnya${nextPending ? ` (${nextPending.product_code || ''})` : ''}`} disabled={busy} className="max-w-md" />
            {nextPending && (
              <div className="text-[11px] text-gray-400 mt-1">
                Berikutnya: {nextPending.product_code || '—'} · {nextPending.product_name || ''} · {nextPending.location || '—'}
              </div>
            )}
            {scanErr && (
              <div className="mt-2 rounded-lg border-[1.5px] border-red-200 bg-red-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-red-700">{scanErr}</div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <TextInput
                    placeholder="Alasan override (wajib)"
                    value={overrideReason}
                    onChange={(ev) => setOverrideReason(ev.target.value)}
                    className="max-w-sm"
                  />
                  <button
                    type="button"
                    onClick={handleOverride}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
                  >
                    Override & Lanjut
                  </button>
                  <button
                    type="button"
                    onClick={() => { setScanErr(null); setOverrideReason(''); }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {items.length === 0 ? (
          <EmptyState message="Belum ada item" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-brand-50">
                <tr>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Product</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Batch</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Location</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Qty</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">UOM</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Pallet</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Picked Qty</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Status</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Picked At</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Picker</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Notes</th>
                  {canWrite && <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const e = edits[item.id] || { qty: item.picked_quantity != null ? String(item.picked_quantity) : '', status: item.status || 'Pending' };
                  return (
                    <tr key={item.id} className="hover:bg-brand-50 transition-colors align-middle">
                      <td className="px-4 py-3 border-t border-gray-100">
                        <div className="text-sm font-semibold text-gray-800">{item.product_code || '—'}</div>
                        <div className="text-xs text-gray-500">{item.product_name || ''}</div>
                      </td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">{item.batch_no || item.batch_number || '—'}</td>
                      <td className="px-4 py-3 border-t border-gray-100 font-mono text-xs text-gray-700">{item.location || '—'}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700 text-right">{fmtNum(item.quantity)}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">{item.uom || '—'}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">{item.pallet ?? '—'}</td>
                      <td className="px-4 py-3 border-t border-gray-100">
                        {canWrite ? (
                          <TextInput
                            type="number"
                            min={0}
                            value={e.qty}
                            onChange={(ev) => setEdits((prev) => ({ ...prev, [item.id]: { ...e, qty: ev.target.value } }))}
                            className="w-24"
                          />
                        ) : (
                          <span className="text-sm text-gray-700">{fmtNum(item.picked_quantity)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 border-t border-gray-100">
                        {canWrite ? (
                          <Select value={e.status} onChange={(ev) => setEdits((prev) => ({ ...prev, [item.id]: { ...e, status: ev.target.value } }))} className="w-32">
                            {ITEM_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <StatusBadge status={item.status} />
                        )}
                      </td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">{fmtDateTime(item.picked_at)}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">{item.picker_id || '—'}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-600">{item.notes || '—'}</td>
                      {canWrite && (
                        <td className="px-4 py-3 border-t border-gray-100 text-right">
                          <button
                            onClick={() => handleUpdateItem(item)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                          >
                            <Save className="w-3.5 h-3.5" /> Simpan
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
