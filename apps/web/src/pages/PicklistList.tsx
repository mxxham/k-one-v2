import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, FileInput } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import Spinner from '@/components/Spinner';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput } from '@/components/Field';

interface PicklistRow {
  id: number;
  picklist_number?: string;
  outbound_order_id?: number | null;
  outbound_number?: string | null;
  wave_id?: number | null;
  wave_number?: string | null;
  created_date?: string;
  status?: string;
  notes?: string;
  created_by_name?: string;
  total_items?: number;
  total_qty?: number;
}

const PER_PAGE = 50;

function statusKey(s: any): string {
  if (typeof s === 'string') return s;
  return s?.key ?? s?.status ?? s?.label ?? String(s ?? '');
}

export default function PicklistList() {
  const { canWrite } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [rows, setRows] = useState<PicklistRow[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [outboundId, setOutboundId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('picklist', 'list', { params: { status: filter, page, per_page: PER_PAGE } });
      setRows(res.rows || []);
      setStatuses((res.statuses || []).map(statusKey));
      setTotal(res.total ?? 0);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data picklist');
    } finally {
      setLoading(false);
    }
  }, [filter, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const id = Number(outboundId);
    if (!id) {
      toast('error', 'Masukkan nomor outbound order');
      return;
    }
    setSaving(true);
    try {
      const res = await api('picklist', 'create_from_outbound', { body: { outbound_id: id } });
      toast('success', 'Picklist berhasil dibuat');
      setCreateOpen(false);
      navigate(`/picklist/${res.id}`);
    } catch (err: any) {
      toast('error', err.message || 'Gagal membuat picklist');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: PicklistRow) => {
    try {
      await api('picklist', 'delete', { body: { id: row.id } });
      toast('success', 'Picklist dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus picklist');
    }
  };

  return (
    <div>
      <PageHeader
        title="Picklist"
        subtitle="Kelola picklist dari outbound order"
        actions={
          <>
            {canWrite && (
              <button
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
              >
                <Plus className="w-4 h-4" /> Create from Outbound
              </button>
            )}
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </>
        }
      />

      <Card>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500">Status:</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-3 py-1.5 border-[1.5px] border-gray-300 rounded-lg text-sm bg-white focus:border-brand-500 outline-none"
            >
              <option value="">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <Spinner label="Loading picklist…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Belum ada picklist" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-brand-50">
                  <tr>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Picklist No</th>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Outbound</th>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Created</th>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Status</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Items</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Qty</th>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Created By</th>
                    <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">Notes</th>
                    {canWrite && <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-brand-700">Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-brand-50 transition-colors">
                      <td className="px-4 py-3 border-t border-gray-100">
                        <Link to={`/picklist/${row.id}`} className="text-sm font-semibold text-brand-600 hover:text-brand-800 hover:underline">
                          {row.picklist_number || `#${row.id}`}
                        </Link>
                      </td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">
                        {row.wave_id ? (
                          <Link to={`/waves`} className="text-brand-600 hover:underline">
                            {row.wave_number || `Wave #${row.wave_id}`}
                          </Link>
                        ) : row.outbound_order_id ? (
                          <Link to={`/outbound/${row.outbound_order_id}`} className="text-brand-600 hover:underline">
                            {row.outbound_number || `#${row.outbound_order_id}`}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">{fmtDate(row.created_date)}</td>
                      <td className="px-4 py-3 border-t border-gray-100">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700 text-right">{fmtNum(row.total_items, 0)}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700 text-right">{fmtNum(row.total_qty)}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-700">{row.created_by_name || '—'}</td>
                      <td className="px-4 py-3 border-t border-gray-100 text-sm text-gray-600 max-w-[180px] truncate">{row.notes || '—'}</td>
                      {canWrite && (
                        <td className="px-4 py-3 border-t border-gray-100 text-right">
                          <ConfirmButton label="Hapus" confirmText={`Hapus picklist ${row.picklist_number || ''}?`} onConfirm={() => handleDelete(row)} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
            </div>
          </>
        )}
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Picklist from Outbound" size="sm">
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Outbound Order ID" required hint="Picklist hanya bisa dibuat dari outbound order yang sudah ada.">
            <TextInput
              type="number"
              min={1}
              value={outboundId}
              onChange={(e) => setOutboundId(e.target.value)}
              placeholder="Contoh: 12"
              autoFocus
            />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-60"
            >
              <FileInput className="w-4 h-4" /> {saving ? 'Membuat…' : 'Buat Picklist'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
