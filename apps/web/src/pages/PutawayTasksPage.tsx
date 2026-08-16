import { useCallback, useEffect, useState } from 'react';
import { Search, ArrowLeft, CheckCheck, X, UserPlus, Save, PackageCheck, Play, Printer, UsersRound, UserCheck } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Spinner from '@/components/Spinner';
import ConfirmButton from '@/components/ConfirmButton';
import { TextInput, Select, Field } from '@/components/Field';
import Modal from '@/components/Modal';
import LpnLabel, { LpnLabelData } from '@/components/LpnLabel';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { fmtNum, fmtDateTime } from '@/lib/format';

const STATUS_OPTIONS = ['', 'Pending', 'In Progress', 'Completed', 'Cancelled'];
const ASSIGNMENT_OPTIONS = ['', 'unassigned', 'assigned'];

function FungsiBadge({ fn }: { fn?: string | null }) {
  const styles: Record<string, string> = {
    PICK_FACE: 'bg-green-100 text-green-700 border-green-300',
    RESERVE: 'bg-blue-100 text-blue-700 border-blue-300',
    MIXED: 'bg-purple-100 text-purple-700 border-purple-300',
  };
  const key = (fn || 'RESERVE').toUpperCase();
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${styles[key] || styles.RESERVE}`}>
      {key === 'PICK_FACE' ? 'PICK FACE' : key === 'MIXED' ? 'MIXED' : 'BULK'}
    </span>
  );
}

function reasonLabel(reason?: string | null) {
  switch (reason) {
    case 'RESERVE_FULL':
      return 'Full → Reserve';
    case 'PICK_FACE_REMAINDER':
    case 'PICK_FACE_FULL':
      return 'Pick Face';
    case 'NO_SLOT_STAGING':
      return 'Staging';
    default:
      return reason || '—';
  }
}

interface TaskRow {
  id: number;
  task_number: string;
  inbound_order_id: number | null;
  order_number: string | null;
  inbound_status: string | null;
  status: string;
  priority: number;
  assigned_to: number | null;
  assigned_name: string | null;
  forklift_operator_id: number | null;
  forklift_operator_name: string | null;
  forklift_operator_full_name: string | null;
  checklist_partner_id: number | null;
  checklist_partner_name: string | null;
  checklist_partner_full_name: string | null;
  created_by_name: string | null;
  pallet_count: number;
  done_count: number;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  created_at: string;
}

interface TaskItem {
  id: number;
  product_code: string | null;
  product_name: string | null;
  batch_number: string | null;
  uom: string | null;
  pallet_seq: number;
  quantity: number;
  lpn_code: string | null;
  suggested_location: string | null;
  actual_location: string | null;
  pallet_function: string;
  reason: string | null;
  status: string;
  completed_by_name: string | null;
  completed_at: string | null;
}

interface AssignableUser {
  id: number;
  username: string;
  full_name: string;
  department: string;
  role: string;
}

export default function PutawayTasksPage() {
  const toast = useToast();
  const { canWrite, department } = useAuth();

  const [rows, setRows] = useState<TaskRow[]>([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [assignment, setAssignment] = useState('');
  // S43: "Tugas Saya" — ops operators open straight onto their own queue.
  const [mine, setMine] = useState(() => department === 'ops');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [detail, setDetail] = useState<{ task: any; rows: TaskItem[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [bins, setBins] = useState<string[]>([]);
  const [editingLoc, setEditingLoc] = useState<Record<number, string>>({});
  const [savingLoc, setSavingLoc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Two-person team assignment + LPN label printing (S49).
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [teamModal, setTeamModal] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamFo, setTeamFo] = useState('');
  const [teamCp, setTeamCp] = useState('');
  const [labelModal, setLabelModal] = useState(false);
  const [label, setLabel] = useState<LpnLabelData | null>(null);
  const [labelBusy, setLabelBusy] = useState(false);

  const loadList = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, any> = {};
      if (status) params.status = status;
      if (search) params.search = search;
      if (mine) params.mine = 1;
      const res = await api('putaway', 'task_list', { params });
      setRows((res.rows || []) as TaskRow[]);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat antrean putaway');
    } finally {
      setLoading(false);
    }
  }, [status, search, mine, toast]);

  const loadBins = useCallback(async () => {
    try {
      const res = await api('putaway', 'bins');
      setBins(((res.rows || []) as Array<{ location_code: string }>).map((b) => b.location_code));
    } catch {
      // datalist is optional — ignore failures
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const res = await api('putaway', 'assignable_users');
      setUsers((res.rows || []) as AssignableUser[]);
    } catch {
      // pickers are optional — ignore failures
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList, refreshKey]);

  useEffect(() => {
    loadBins();
  }, [loadBins]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openDetail = async (id: number) => {
    try {
      setLoadingDetail(true);
      const res = await api('putaway', 'task_detail', { params: { id } });
      setDetail({ task: res.task, rows: (res.rows || []) as TaskItem[] });
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat detail task');
    } finally {
      setLoadingDetail(false);
    }
  };

  const run = async (action: string, body: any, msg: string) => {
    try {
      setBusy(true);
      await api('putaway', action, { body });
      toast('success', msg);
      setRefreshKey((k) => k + 1);
      if (detail) await openDetail(detail.task.id);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memproses task');
    } finally {
      setBusy(false);
    }
  };

  const saveLocation = async (item: TaskItem) => {
    const loc = (editingLoc[item.id] ?? '').trim().toUpperCase();
    if (!loc) return toast('error', 'Lokasi wajib diisi.');
    try {
      setSavingLoc(item.id);
      await api('putaway', 'task_update_pallet', { body: { id: item.id, location: loc } });
      toast('success', `Lokasi pallet → ${loc}`);
      setRefreshKey((k) => k + 1);
      if (detail) await openDetail(detail.task.id);
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan lokasi');
    } finally {
      setSavingLoc(null);
    }
  };

  const openAssign = (task: any) => {
    setTeamFo(task.forklift_operator_id ? String(task.forklift_operator_id) : '');
    setTeamCp(task.checklist_partner_id ? String(task.checklist_partner_id) : '');
    setTeamModal(true);
  };

  const submitAssign = async () => {
    if (!teamFo || !teamCp) return toast('error', 'Pilih forklift operator dan checklist partner.');
    if (!detail) return;
    try {
      setTeamBusy(true);
      await api('putaway', 'assign_task', {
        body: { id: detail.task.id, forklift_operator_id: Number(teamFo), checklist_partner_id: Number(teamCp) },
      });
      toast('success', 'Tim putaway ditugaskan.');
      setTeamModal(false);
      setRefreshKey((k) => k + 1);
      await openDetail(detail.task.id);
    } catch (err: any) {
      toast('error', err.message || 'Gagal menugaskan tim');
    } finally {
      setTeamBusy(false);
    }
  };

  const printLabel = async (item: TaskItem) => {
    try {
      setLabelBusy(true);
      const res = await api('putaway', 'print_lpn_label', { body: { id: item.id } });
      setLabel(res.label as LpnLabelData);
      setLabelModal(true);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat label LPN');
    } finally {
      setLabelBusy(false);
    }
  };

  const task = detail?.task;
  const pendingRows = detail?.rows.filter((r) => r.status === 'Pending').length ?? 0;
  const doneRows = detail?.rows.filter((r) => r.status === 'Done').length ?? 0;
  const editable = task && (task.status === 'Pending' || task.status === 'In Progress');
  const hasTeam = task && (task.forklift_operator_id || task.checklist_partner_id);
  const visibleRows = rows.filter((r) => {
    if (assignment === 'unassigned') return !r.forklift_operator_id && !r.checklist_partner_id;
    if (assignment === 'assigned') return !!r.forklift_operator_id || !!r.checklist_partner_id;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Putaway Tasks"
        subtitle="Antrean putaway — pallet diterima saat Goods Received (LPN dicetak), tim 2 orang ditugaskan, dikonfirmasi, lalu ditulis ke stock."
      />

      <Card title={detail ? 'Detail Task' : 'Antrean Putaway'}>
        {detail ? (
          <>
            <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setDetail(null)}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-900"
                  >
                    <ArrowLeft className="w-4 h-4" /> Kembali
                  </button>
                  <h2 className="text-lg font-bold">{task.task_number}</h2>
                  <StatusBadge status={task.status} />
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  Inbound <span className="font-semibold">{task.order_number || '—'}</span>
                  {task.assigned_name ? ` · Operator: ${task.assigned_name}` : ''}
                  {task.forklift_operator_full_name || task.forklift_operator_name
                    ? ` · Forklift: ${task.forklift_operator_full_name ?? task.forklift_operator_name}`
                    : ''}
                  {task.checklist_partner_full_name || task.checklist_partner_name
                    ? ` · Checklist: ${task.checklist_partner_full_name ?? task.checklist_partner_name}`
                    : ''}
                  {task.created_by_name ? ` · Dibuat: ${task.created_by_name}` : ''}
                  {task.completed_at ? ` · Selesai: ${fmtDateTime(task.completed_at)}` : ''}
                  {task.cancelled_at ? ` · Batal: ${fmtDateTime(task.cancelled_at)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {editable && !hasTeam && canWrite && (
                  <button
                    onClick={() => openAssign(task)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                  >
                    <UsersRound className="w-4 h-4" /> Tugaskan Tim
                  </button>
                )}
                {editable && hasTeam && canWrite && (
                  <>
                    <button
                      onClick={() => openAssign(task)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                    >
                      <UsersRound className="w-4 h-4" /> Ubah Tim
                    </button>
                    <ConfirmButton
                      label="Lepas Tim"
                      confirmText="Ya, hapus penugasan tim"
                      onConfirm={() => run('unassign_task', { id: task.id }, 'Penugasan tim dihapus.')}
                      variant="ghost"
                    />
                  </>
                )}
                {editable && !task.assigned_to && canWrite && (
                  <button
                    onClick={() => run('task_assign', { id: task.id }, 'Task diambil.')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                  >
                    <UserPlus className="w-4 h-4" /> Ambil Task
                  </button>
                )}
                {task.status === 'Pending' && task.assigned_to && canWrite && (
                  <button
                    onClick={() => run('task_assign', { id: task.id }, 'Task diproses.')}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
                  >
                    <Play className="w-4 h-4" /> Mulai Proses
                  </button>
                )}
                {pendingRows === 0 && task.status !== 'Completed' && task.status !== 'Cancelled' && canWrite && (
                  <button
                    onClick={() => run('task_complete', { id: task.id }, `Task ${task.task_number} selesai — stock ditulis.`)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCheck className="w-4 h-4" /> Selesaikan Task
                  </button>
                )}
                {editable && canWrite && (
                  <ConfirmButton
                    label="Batalkan"
                    confirmText="Ya, batalkan task"
                    onConfirm={() => run('task_cancel', { id: task.id }, 'Task dibatalkan.')}
                    variant="danger"
                  />
                )}
              </div>
            </div>

            <div className="mb-4 flex items-center gap-2 text-sm">
              <PackageCheck className="w-4 h-4 text-gray-500" />
              <span className="font-semibold">{doneRows}/{detail.rows.length}</span>
              <span className="text-gray-500">pallet selesai</span>
              <span className="ml-3 text-gray-500">Total qty:</span>
              <span className="font-semibold">{fmtNum(detail.rows.reduce((a, r) => a + r.quantity, 0))}</span>
            </div>

            {loadingDetail ? (
              <Spinner label="Memuat detail…" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">Produk</th>
                      <th className="py-2 pr-3">Batch</th>
                      <th className="py-2 pr-3">LPN</th>
                      <th className="py-2 pr-3">Pallet</th>
                      <th className="py-2 pr-3">Qty</th>
                      <th className="py-2 pr-3">Lokasi Disarankan</th>
                      <th className="py-2 pr-3">Lokasi Aktual</th>
                      <th className="py-2 pr-3">Fungsi</th>
                      <th className="py-2 pr-3">Alasan</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.rows.map((item) => {
                      const locVal = editingLoc[item.id] ?? item.actual_location ?? item.suggested_location ?? '';
                      const isDone = item.status === 'Done';
                      return (
                        <tr key={item.id} className="border-b last:border-0 align-middle">
                          <td className="py-2 pr-3">
                            <div className="font-semibold">{item.product_code || '—'}</div>
                            <div className="text-gray-500 text-xs">{item.product_name || ''}</div>
                          </td>
                          <td className="py-2 pr-3">{item.batch_number || '—'}</td>
                          <td className="py-2 pr-3">
                            <span className="font-mono text-xs font-semibold">{item.lpn_code || '—'}</span>
                          </td>
                          <td className="py-2 pr-3">#{item.pallet_seq}</td>
                          <td className="py-2 pr-3">{fmtNum(item.quantity)}</td>
                          <td className="py-2 pr-3">{item.suggested_location || '—'}</td>
                          <td className="py-2 pr-3">
                            {editable && !isDone ? (
                              <div className="flex items-center gap-1">
                                <TextInput
                                  value={locVal}
                                  onChange={(e) => setEditingLoc((m) => ({ ...m, [item.id]: e.target.value }))}
                                  list={`bins-${item.id}`}
                                  className="w-32"
                                />
                                <datalist id={`bins-${item.id}`}>
                                  {bins.map((b) => (
                                    <option key={b} value={b} />
                                  ))}
                                </datalist>
                                <button
                                  onClick={() => saveLocation(item)}
                                  disabled={savingLoc === item.id || locVal === item.actual_location}
                                  className="p-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
                                  title="Simpan lokasi"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              item.actual_location || item.suggested_location || '—'
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <FungsiBadge fn={item.actual_location ? palletFunctionOf(item.actual_location) : item.pallet_function} />
                          </td>
                          <td className="py-2 pr-3">{reasonLabel(item.reason)}</td>
                          <td className="py-2 pr-3">
                            {isDone ? (
                              <span className="text-xs text-emerald-700 font-semibold">
                                Done {item.completed_by_name ? `· ${item.completed_by_name}` : ''}
                              </span>
                            ) : (
                              <StatusBadge status="Pending" />
                            )}
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-1.5">
                              {canWrite && (
                                <button
                                  onClick={() => printLabel(item)}
                                  disabled={labelBusy}
                                  className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                                  title="Cetak label LPN"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {detail.rows.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-gray-400">
                          Tidak ada pallet dalam task ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <TextInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari task / inbound…"
                  className="pl-9"
                />
              </div>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s === '' ? 'Semua status' : s}
                  </option>
                ))}
              </Select>
              <Select value={assignment} onChange={(e) => setAssignment(e.target.value)} className="w-48">
                {ASSIGNMENT_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a === '' ? 'Semua penugasan' : a === 'unassigned' ? 'Belum ditugaskan' : 'Sudah ditugaskan'}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => setMine((m) => !m)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                  mine
                    ? 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
                title="Tampilkan hanya task yang menjadi milik saya (diambil / ditugaskan ke saya)"
              >
                <UserCheck className="w-3.5 h-3.5" />
                Tugas Saya
              </button>
            </div>

            {loading ? (
              <Spinner label="Memuat antrean…" />
            ) : visibleRows.length === 0 ? (
              <EmptyState message="Tidak ada putaway task. Task dibuat otomatis saat item inbound menerima Goods Received." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">Task</th>
                      <th className="py-2 pr-3">Inbound</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Pallet</th>
                      <th className="py-2 pr-3">Tim Putaway</th>
                      <th className="py-2 pr-3">Dibuat</th>
                      <th className="py-2">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b last:border-0 cursor-pointer hover:bg-gray-50"
                        onClick={() => openDetail(r.id)}
                      >
                        <td className="py-2 pr-3 font-bold text-brand-700">{r.task_number}</td>
                        <td className="py-2 pr-3">{r.order_number || '—'}</td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="py-2 pr-3">
                          {r.done_count}/{r.pallet_count}
                        </td>
                        <td className="py-2 pr-3">
                          {r.forklift_operator_name || r.checklist_partner_name ? (
                            <div>
                              <div className="text-xs">
                                <span className="text-gray-500">Forklift:</span>{' '}
                                <span className="font-semibold">{r.forklift_operator_full_name ?? r.forklift_operator_name}</span>
                              </div>
                              <div className="text-xs">
                                <span className="text-gray-500">Checklist:</span>{' '}
                                <span className="font-semibold">{r.checklist_partner_full_name ?? r.checklist_partner_name}</span>
                              </div>
                            </div>
                          ) : r.assigned_name ? (
                            <span className="text-xs">{r.assigned_name}</span>
                          ) : (
                            <span className="text-xs text-amber-600 font-semibold">Belum ditugaskan</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{fmtDateTime(r.created_at)}</td>
                        <td className="py-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetail(r.id);
                            }}
                            className="text-sm font-semibold text-brand-700 hover:text-brand-900"
                          >
                            Detail →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      <Modal open={teamModal} onClose={() => setTeamModal(false)} title={`Tugaskan Tim Putaway — ${task?.task_number ?? ''}`} size="sm">
        <div className="space-y-4">
          <Field label="Forklift Operator" required>
            <Select value={teamFo} onChange={(e) => setTeamFo(e.target.value)}>
              <option value="">— Pilih operator —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.username}){u.department !== 'all' ? ` · ${u.department}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Checklist Partner" required>
            <Select value={teamCp} onChange={(e) => setTeamCp(e.target.value)}>
              <option value="">— Pilih partner —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.username}){u.department !== 'all' ? ` · ${u.department}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setTeamModal(false)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
            >
              Batal
            </button>
            <button
              onClick={submitAssign}
              disabled={teamBusy}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
            >
              {teamBusy ? 'Menyimpan…' : 'Tugaskan Tim'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={labelModal} onClose={() => setLabelModal(false)} title="Label LPN" size="sm">
        {labelBusy ? <Spinner label="Memuat label…" /> : label ? <LpnLabel label={label} /> : null}
      </Modal>
    </div>
  );
}

function palletFunctionOf(location: string): string {
  const lvl = location.trim().toUpperCase();
  const m = lvl.match(/([A-E])$/);
  return m && m[1] === 'A' ? 'PICK_FACE' : 'RESERVE';
}