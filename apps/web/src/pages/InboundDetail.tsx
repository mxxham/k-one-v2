import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Edit3, CalendarDays, Boxes, MapPin, Layers, ChevronRight, Printer, ClipboardList, AlertTriangle, Sparkles, UsersRound } from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { fmtDate, fmtNum, todayISO } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';

import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, Select, Grid } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import ScanInput from '@/components/ScanInput';
import LpnLabel, { LpnLabelData } from '@/components/LpnLabel';

const ITEM_STATUSES = ['Dues In', 'Goods Received', 'Unserviceable', 'ATP'];
const WORKFLOW_STEPS = ['Draft', 'Dues In', 'Receiving', 'Goods Received', 'ATP', 'Completed'];

const ITEM_STATUS_PILL: Record<string, string> = {
  'Dues In': 'bg-amber-50 text-amber-700 border-amber-300',
  'Goods Received': 'bg-blue-50 text-blue-700 border-blue-300',
  ATP: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  Unserviceable: 'bg-red-50 text-red-700 border-red-300',
};

interface OrderDetail {
  id: number;
  order_number: string;
  order_date: string;
  carrier_name?: string;
  po_number?: string;
  shipment_no?: string;
  do_number?: string;
  container_no?: string;
  armada_no?: string;
  production_date?: string;
  expected_date?: string;
  status: string;
  notes?: string;
  received_by_name?: string;
  received_date?: string;
  created_by_name?: string;
  od_numbers?: string;
}

interface PalletLocation {
  id?: number;
  location_code: string;
  pallet_seq: number;
  quantity: number;
  original_quantity?: number;
  status?: string;
}

interface ItemDetail {
  id: number;
  inbound_order_id?: number;
  od_number?: string;
  so_number?: string;
  product_id?: number;
  product_code: string;
  product_name?: string;
  batch_number?: string;
  location?: string;
  quantity: number;
  uom?: string;
  actual_qty?: number;
  pallet?: number;
  pallet_no?: string;
  manufacture_date?: string;
  exp_date?: string;
  stock_status?: string;
  in_process_status?: string;
  notes?: string;
  pallet_locations?: PalletLocation[];
  cross_dock_outbound_order_id?: number | null;
  cross_dock_order_number?: string;
  cross_dock_order_status?: string;
}

interface DetailUser {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface DetailData {
  order: OrderDetail;
  items: ItemDetail[];
  locations?: string[];
  item_pallet_counts?: Record<string, number>;
  users?: DetailUser[];
  products?: any[];
  cross_dock_orders?: any[];
  putaway_task?: PutawayTaskData | null;
}

interface PutawayTaskRow {
  id: number;
  inbound_item_id: number | null;
  product_id: number | null;
  product_code: string | null;
  product_name: string | null;
  batch_number: string | null;
  uom: string | null;
  pallet_seq: number;
  quantity: number;
  suggested_location: string | null;
  actual_location: string | null;
  status: string;
  lpn_code: string | null;
}

interface PutawayTaskData {
  task: {
    id: number;
    task_number: string;
    status: string;
    assigned_to: number | null;
    assigned_name: string | null;
    forklift_operator_id: number | null;
    forklift_operator_name: string | null;
    checklist_partner_id: number | null;
    checklist_partner_name: string | null;
    pallet_count: number;
    done_count: number;
  };
  rows: PutawayTaskRow[];
}

interface AssignableUser {
  id: number;
  username: string;
  full_name: string;
  department: string;
  role: string;
}

interface SearchProduct {
  id: number;
  product_code: string;
  product_name: string;
  uom: string;
  uom_per_pallet: number;
  liters_per_unit?: number;
  stock_qty: number;
}

interface AddItemForm {
  product_id: number | null;
  product_code: string;
  product_name: string;
  uom: string;
  batch_number: string;
  od_number: string;
  so_number: string;
  quantity: string;
  manufacture_date: string;
  exp_date: string;
  in_process_status: string;
  cross_dock_outbound_order_id: number | null;
}

interface PalletRow {
  pallet_seq: number;
  location_code: string;
  quantity: string;
  is_full: boolean;
}

interface AddLocRow {
  location_code: string;
  quantity: string;
  is_full: boolean;
}

function InfoItem({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm font-medium text-gray-800 mt-0.5 break-words">{value || '—'}</div>
    </div>
  );
}

function ActionBtn({ onClick, title, disabled, children }: { onClick: () => void; title: string; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded-lg text-gray-500 hover:text-brand-700 hover:bg-brand-50 border border-transparent hover:border-brand-100 disabled:opacity-40 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function ItemStatusPill({ status }: { status?: string | null }) {
  const key = status || '—';
  const cls = ITEM_STATUS_PILL[key] || 'bg-gray-100 text-gray-600 border-gray-300';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${cls}`}>{key}</span>
  );
}

function ProductSearch({
  selected,
  onSelect,
  onClear,
  autoFocus,
}: {
  selected: { id: number; code: string; name: string } | null;
  onSelect: (p: SearchProduct) => void;
  onClear: () => void;
  autoFocus?: boolean;
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api('inbound', 'search_products', { params: { q } });
        setResults(res.results || []);
        setOpen(true);
      } catch (e: any) {
        toast('error', e.message || 'Gagal mencari produk');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (selected) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 px-3 py-2 rounded-lg bg-brand-50 border border-brand-100 text-sm">
          <div className="font-semibold text-brand-900">{selected.code}</div>
          <div className="text-[11px] text-gray-500 truncate">{selected.name}</div>
        </div>
        <button type="button" onClick={onClear} className="px-2 py-1 text-xs font-semibold text-gray-500 hover:text-red-600 flex-shrink-0">
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <TextInput
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search product..."
          className="pl-9"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-brand-600 font-semibold">Searching...</span>
        )}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {results.length === 0 && !searching && <div className="px-3 py-2 text-xs text-gray-400">No products found</div>}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p);
                setOpen(false);
                setQ('');
                setResults([]);
              }}
              className="w-full text-left px-3 py-2 hover:bg-brand-50 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800">{p.product_code}</div>
                <div className="text-[11px] text-gray-500 truncate">{p.product_name}</div>
              </div>
              <div className="text-[11px] text-gray-400 flex-shrink-0">Stock: {fmtNum(p.stock_qty, 0)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export default function InboundDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { canWrite, canAdmin, user } = useAuth();

  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [receivedBy, setReceivedBy] = useState('');
  const [receivedDate, setReceivedDate] = useState(todayISO());

  const [editQtyItem, setEditQtyItem] = useState<ItemDetail | null>(null);
  const [qtyValue, setQtyValue] = useState('');

  const [editDatesItem, setEditDatesItem] = useState<ItemDetail | null>(null);
  const [mfgValue, setMfgValue] = useState('');
  const [expValue, setExpValue] = useState('');

  const [palletNoItem, setPalletNoItem] = useState<ItemDetail | null>(null);
  const [palletNoValue, setPalletNoValue] = useState('');

  const [scanErr, setScanErr] = useState<string | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [scanMatchId, setScanMatchId] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const [locItem, setLocItem] = useState<ItemDetail | null>(null);
  const [locValue, setLocValue] = useState('');

  const [palletItem, setPalletItem] = useState<ItemDetail | null>(null);
  const [palletRows, setPalletRows] = useState<PalletRow[]>([]);
  const [palletSuggesting, setPalletSuggesting] = useState(false);
  const [palletSuggestMsg, setPalletSuggestMsg] = useState('');

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItem, setAddItem] = useState<AddItemForm>({
    product_id: null,
    product_code: '',
    product_name: '',
    uom: '',
    batch_number: '',
    od_number: '',
    so_number: '',
    quantity: '',
    manufacture_date: '',
    exp_date: '',
    in_process_status: 'Dues In',
    cross_dock_outbound_order_id: null,
  });
  const [addLocations, setAddLocations] = useState<AddLocRow[]>([]);
  const [addSuggesting, setAddSuggesting] = useState(false);
  const [addSuggestMsg, setAddSuggestMsg] = useState('');

  // Putaway task on the inbound screen (S49): LPN label print + 2-person team
  // assignment (forklift operator + checklist partner who scans on mobile).
  const [putawayUsers, setPutawayUsers] = useState<AssignableUser[]>([]);
  const [teamModal, setTeamModal] = useState(false);
  const [teamFo, setTeamFo] = useState('');
  const [teamCp, setTeamCp] = useState('');
  const [teamBusy, setTeamBusy] = useState(false);
  const [labelModal, setLabelModal] = useState(false);
  const [label, setLabel] = useState<LpnLabelData | null>(null);
  const [labelBusy, setLabelBusy] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api('inbound', 'detail', { params: { id } });
      setData(res as unknown as DetailData);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat detail inbound');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const loadPutawayUsers = useCallback(async () => {
    try {
      const res = await api('putaway', 'assignable_users');
      setPutawayUsers((res.rows || []) as AssignableUser[]);
    } catch {
      // pickers are optional — ignore failures
    }
  }, []);

  useEffect(() => {
    loadPutawayUsers();
  }, [loadPutawayUsers]);

  const openTeamAssign = () => {
    const pt = data?.putaway_task;
    if (!pt) return;
    setTeamFo(pt.task.forklift_operator_id ? String(pt.task.forklift_operator_id) : '');
    setTeamCp(pt.task.checklist_partner_id ? String(pt.task.checklist_partner_id) : '');
    setTeamModal(true);
  };

  const submitTeamAssign = async () => {
    const pt = data?.putaway_task;
    if (!pt) return;
    if (!teamFo || !teamCp) return toast('error', 'Pilih forklift operator dan checklist partner.');
    try {
      setTeamBusy(true);
      await api('putaway', 'assign_task', {
        body: { id: pt.task.id, forklift_operator_id: Number(teamFo), checklist_partner_id: Number(teamCp) },
      });
      toast('success', 'Tim putaway ditugaskan.');
      setTeamModal(false);
      await fetchDetail();
    } catch (e: any) {
      toast('error', e.message || 'Gagal menugaskan tim');
    } finally {
      setTeamBusy(false);
    }
  };

  const unassignTeam = async () => {
    const pt = data?.putaway_task;
    if (!pt) return;
    try {
      setTeamBusy(true);
      await api('putaway', 'unassign_task', { body: { id: pt.task.id } });
      toast('success', 'Penugasan tim dihapus.');
      await fetchDetail();
    } catch (e: any) {
      toast('error', e.message || 'Gagal menghapus penugasan tim');
    } finally {
      setTeamBusy(false);
    }
  };

  const printLpnLabel = async (rowId: number) => {
    try {
      setLabelBusy(true);
      const res = await api('putaway', 'print_lpn_label', { body: { id: rowId } });
      setLabel(res.label as LpnLabelData);
      setLabelModal(true);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat label LPN');
    } finally {
      setLabelBusy(false);
    }
  };

  const runMutation = async (fn: () => Promise<any>, successMsg: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      toast('success', successMsg);
      await fetchDetail();
      return true;
    } catch (e: any) {
      toast('error', e.message || 'Gagal menyimpan perubahan');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const advanceToDuesIn = async () => {
    await runMutation(
      () => api('inbound', 'advance_status', { body: { id: Number(id), status: 'Dues In' } }),
      'Status berhasil diubah ke Dues In',
    );
  };

  const advanceToReceiving = async () => {
    if (!receivedBy) {
      toast('error', 'Received by wajib diisi');
      return;
    }
    const ok = await runMutation(
      () =>
        api('inbound', 'advance_status', {
          body: {
            id: Number(id),
            status: 'Receiving',
            received_by_id: Number(receivedBy),
            received_date: receivedDate || todayISO(),
          },
        }),
      'Status berhasil diubah ke Receiving',
    );
    if (ok) setAdvanceOpen(false);
  };

  const completeOrder = async () => {
    await runMutation(() => api('inbound', 'complete', { body: { id: Number(id) } }), 'Inbound berhasil dikomplit');
  };

  const repairLedger = async () => {
    await runMutation(() => api('inbound', 'repair_ledger', { body: { id: Number(id) } }), 'Repair ledger berhasil dijalankan');
  };

  const deleteOrder = async () => {
    try {
      await api('inbound', 'delete', { body: { id: Number(id) } });
      toast('success', 'Inbound dihapus');
      navigate('/inbound');
    } catch (e: any) {
      toast('error', e.message || 'Gagal menghapus inbound');
    }
  };

  const openEditQty = (item: ItemDetail) => {
    setQtyValue(String(item.quantity ?? ''));
    setEditQtyItem(item);
  };
  const saveQty = async () => {
    if (!editQtyItem) return;
    const ok = await runMutation(
      () => api('inbound', 'update_item_qty', { body: { item_id: editQtyItem.id, quantity: Number(qtyValue), inbound_id: Number(id) } }),
      'Quantity item diperbarui',
    );
    if (ok) setEditQtyItem(null);
  };

  const openEditDates = (item: ItemDetail) => {
    setMfgValue(item.manufacture_date || '');
    setExpValue(item.exp_date || '');
    setEditDatesItem(item);
  };
  const saveDates = async () => {
    if (!editDatesItem) return;
    const ok = await runMutation(
      () =>
        api('inbound', 'update_item_dates', {
          body: { item_id: editDatesItem.id, manufacture_date: mfgValue || undefined, exp_date: expValue || undefined },
        }),
      'Tanggal item diperbarui',
    );
    if (ok) setEditDatesItem(null);
  };

  const openPalletNo = (item: ItemDetail) => {
    setPalletNoValue(item.pallet_no || '');
    setPalletNoItem(item);
  };
  const savePalletNo = async () => {
    if (!palletNoItem) return;
    const ok = await runMutation(
      () => api('inbound', 'update_item_pallet_no', { body: { item_id: palletNoItem.id, pallet_no: palletNoValue || undefined } }),
      'Pallet no diperbarui',
    );
    if (ok) setPalletNoItem(null);
  };

  const openLoc = (item: ItemDetail) => {
    setLocValue(item.location || '');
    setLocItem(item);
  };
  const saveLoc = async () => {
    if (!locItem) return;
    const ok = await runMutation(
      () => api('inbound', 'save_item_location', { body: { item_id: locItem.id, inbound_id: Number(id), location: locValue } }),
      'Lokasi item disimpan',
    );
    if (ok) setLocItem(null);
  };

  const updateItemStatus = (item: ItemDetail, status: string) => {
    runMutation(
      () => api('inbound', 'update_item_status', { body: { item_id: item.id, inbound_id: Number(id), status } }),
      `Status item ${status} disimpan`,
    );
  };

  // Phase 2 — scanner-first putaway: a matching scan auto-advances the expected
  // item (next in Dues In/Goods Received that still needs putaway).
  const putawayTarget = data?.items.find((it) => it.in_process_status === 'Dues In' || it.in_process_status === 'Goods Received') ?? null;
  const scanNextStatus = putawayTarget?.in_process_status === 'Dues In' ? 'Goods Received' : 'ATP';

  const handleScan = async (code: string) => {
    setScanErr(null);
    setScanMatchId(null);
    setOverrideReason('');
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
    const expectedCode = putawayTarget?.product_code || '';
    if (putawayTarget && expectedCode && scannedCode === expectedCode) {
      setScanMatchId(putawayTarget.id);
      const next = putawayTarget.in_process_status === 'Dues In' ? 'Goods Received' : 'ATP';

      let orderStatus = order.status;
      if (orderStatus === 'Draft') {
        await api('inbound', 'advance_status', { body: { id: Number(id), status: 'Dues In' } });
        orderStatus = 'Dues In';
      }
      if (orderStatus === 'Dues In' && user?.id) {
        await api('inbound', 'advance_status', {
          body: { id: Number(id), status: 'Receiving', received_by_id: user.id, received_date: todayISO() },
        });
      }

      await runMutation(
        () =>
          api('inbound', 'update_item_status', {
            body: { item_id: putawayTarget.id, inbound_id: Number(id), status: next },
          }),
        `${putawayTarget.product_code || scannedCode} → ${next}`,
      );

      const fresh: any = await api('inbound', 'detail', { params: { id } });
      const freshItems: ItemDetail[] = fresh?.items ?? [];
      const allDone = freshItems.length > 0 && freshItems.every((it) => ['ATP', 'Unserviceable'].includes(it.in_process_status ?? ''));
      if (allDone) {
        await api('inbound', 'complete', { body: { id: Number(id) } });
        await fetchDetail();
        toast('success', 'Inbound otomatis dikomplit');
      }
    } else {
      setScanCode(code);
      setScanErr(
        `Kode '${scannedCode}' tidak cocok dengan item yang diproses${expectedCode ? ` '${expectedCode}'` : ' (tidak ada item yang perlu putaway)'}.`,
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
        body: { code: scanCode, reason: overrideReason.trim(), context: `inbound:${order?.order_number || ''}` },
      });
      setScanErr(null);
      setOverrideReason('');
      toast('success', 'Override dicatat');
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan override');
    }
  };

  const openPalletModal = async (item: ItemDetail) => {
    const existing = item.pallet_locations && item.pallet_locations.length ? item.pallet_locations : [{ pallet_seq: 1, location_code: '', quantity: 0 }];
    setPalletRows(
      existing.map((r) => ({
        pallet_seq: r.pallet_seq,
        location_code: r.location_code || '',
        quantity: String(r.quantity ?? ''),
        is_full: true,
      })),
    );
    setPalletItem(item);
    setPalletSuggestMsg('');
    const hasSaved = existing.some((r) => r.location_code && String(r.location_code).trim());
    if (!hasSaved && !item.cross_dock_outbound_order_id && item.product_id) {
      setPalletSuggesting(true);
      try {
        const res: any = await api('putaway', 'recommend', {
          params: { product_id: item.product_id, quantity: item.quantity, uom: item.uom },
        });
        if (res?.pallets?.length) {
          setPalletRows(
            res.pallets.map((p: any) => ({
              pallet_seq: p.pallet_seq,
              location_code: p.location_code || '',
              quantity: String(p.quantity ?? ''),
              is_full: p.is_full !== false,
            })),
          );
        }
        setPalletSuggestMsg(putawayMsg(res, `Saran lokasi putaway: ${res?.pallets?.length ?? 0} pallet.`));
      } catch (e: any) {
        setPalletSuggestMsg(e.message || 'Gagal mendapat saran lokasi putaway.');
      } finally {
        setPalletSuggesting(false);
      }
    }
  };
  const putawayMsg = (res: any, fallback: string): string => {
    if (res?.message) return res.message;
    const upp = Number(res?.uom_per_pallet ?? 0);
    const n = res?.pallets?.length ?? 0;
    if (!upp || n === 0) return fallback;
    const full = res.pallets.filter((p: any) => p.is_full).length;
    const rem = res.pallets.find((p: any) => !p.is_full)?.quantity;
    const parts: string[] = [];
    if (full > 0) parts.push(`${full} pallet penuh @ ${upp} pcs`);
    if (rem && Number(rem) > 0) parts.push(`sisa ${rem} pcs ke pick-face`);
    return `Saran putaway: ${parts.join(', ')} (${n} lokasi).`;
  };
  const suggestPallet = async () => {
    if (!palletItem?.product_id) return;
    setPalletSuggesting(true);
    setPalletSuggestMsg('');
    try {
      const res: any = await api('putaway', 'recommend', {
        params: { product_id: palletItem.product_id, quantity: palletItem.quantity, uom: palletItem.uom },
      });
      if (res?.pallets?.length) {
        setPalletRows(
          res.pallets.map((p: any) => ({
            pallet_seq: p.pallet_seq,
            location_code: p.location_code || '',
            quantity: String(p.quantity ?? ''),
            is_full: p.is_full !== false,
          })),
        );
      }
      setPalletSuggestMsg(putawayMsg(res, 'Saran lokasi putaway diperbarui.'));
    } catch (e: any) {
      setPalletSuggestMsg(e.message || 'Gagal mendapat saran lokasi putaway.');
    } finally {
      setPalletSuggesting(false);
    }
  };
  const updatePalletRow = (i: number, patch: Partial<PalletRow>) =>
    setPalletRows((arr) => arr.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addPalletRow = () => setPalletRows((arr) => [...arr, { pallet_seq: arr.length + 1, location_code: '', quantity: '', is_full: true }]);
  const removePalletRow = (i: number) => setPalletRows((arr) => arr.filter((_, idx) => idx !== i));
  const savePallet = async () => {
    if (!palletItem) return;
    const ok = await runMutation(
      () =>
        api('inbound', 'save_pallet_locations', {
          body: {
            item_id: palletItem.id,
            inbound_id: Number(id),
            pallet_locations: palletRows.map((r, i) => ({
              location_code: r.location_code.trim(),
              pallet_seq: r.pallet_seq || i + 1,
              quantity: Number(r.quantity) || 0,
              is_full: r.is_full,
            })),
          },
        }),
      'Pallet locations disimpan',
    );
    if (ok) setPalletItem(null);
  };

  const deleteItem = (item: ItemDetail) => {
    runMutation(
      () => api('inbound', 'delete_item', { body: { item_id: item.id, inbound_id: Number(id) } }),
      'Item dihapus',
    );
  };

  const openAddItem = () => {
    setAddItem({
      product_id: null,
      product_code: '',
      product_name: '',
      uom: '',
      batch_number: '',
      od_number: '',
      so_number: '',
      quantity: '',
      manufacture_date: '',
      exp_date: '',
      in_process_status: 'Dues In',
      cross_dock_outbound_order_id: null,
    });
    setAddLocations([{ location_code: '', quantity: '', is_full: true }]);
    setAddItemOpen(true);
  };
  const saveAddItem = async () => {
    if (!addItem.product_id) {
      toast('error', 'Pilih produk terlebih dahulu');
      return;
    }
    if (!Number(addItem.quantity)) {
      toast('error', 'Quantity wajib diisi');
      return;
    }
    const ok = await runMutation(
      () =>
        api('inbound', 'add_item', {
          body: {
            inbound_id: Number(id),
            item: {
              product_id: addItem.product_id,
              batch_number: addItem.batch_number || undefined,
              od_number: addItem.od_number || undefined,
              so_number: addItem.so_number || undefined,
              quantity: Number(addItem.quantity),
              uom: addItem.uom || undefined,
              actual_qty: Number(addItem.quantity),
              manufacture_date: addItem.manufacture_date || undefined,
              exp_date: addItem.exp_date || undefined,
              in_process_status: addItem.in_process_status,
              cross_dock_outbound_order_id: addItem.cross_dock_outbound_order_id || undefined,
              pallet_locations: addLocations
                .filter((r) => r.location_code.trim() && Number(r.quantity) > 0)
                .map((r, i) => ({
                  location_code: r.location_code.trim(),
                  pallet_seq: i + 1,
                  quantity: Number(r.quantity),
                  is_full: r.is_full,
                })),
            },
          },
        }),
      'Item berhasil ditambahkan',
    );
    if (ok) setAddItemOpen(false);
  };

  const updateAddLoc = (i: number, patch: Partial<AddLocRow>) =>
    setAddLocations((arr) => arr.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeAddLoc = (i: number) => setAddLocations((arr) => arr.filter((_, idx) => idx !== i));
  const suggestAddLocations = async () => {
    if (!addItem.product_id) {
      toast('error', 'Pilih produk terlebih dahulu');
      return;
    }
    if (!Number(addItem.quantity)) {
      toast('error', 'Quantity wajib diisi');
      return;
    }
    setAddSuggesting(true);
    setAddSuggestMsg('');
    try {
      const params: Record<string, string | number> = { product_id: addItem.product_id, quantity: Number(addItem.quantity) };
      if (addItem.uom) params.uom = addItem.uom;
      const res: any = await api('putaway', 'recommend', { params });
      if (res?.pallets?.length) {
        setAddLocations(
          res.pallets.map((p: any) => ({
            location_code: p.location_code || '',
            quantity: String(p.quantity ?? ''),
            is_full: p.is_full !== false,
          })),
        );
      }
      setAddSuggestMsg(putawayMsg(res, `Saran lokasi putaway: ${res?.pallets?.length ?? 0} pallet.`));
    } catch (e: any) {
      setAddSuggestMsg(e.message || 'Gagal mendapat saran lokasi putaway.');
    } finally {
      setAddSuggesting(false);
    }
  };
  if (loading) return <Spinner label="Loading detail..." />;
  if (!data) return <EmptyState message="Data tidak ditemukan" />;

  const order = data.order;
  const statusNorm = (s: string) => (s === 'Good Received' ? 'Goods Received' : s);
  const orderIdx = WORKFLOW_STEPS.indexOf(statusNorm(order.status));
  const wfItems = data.items ?? [];
  const allDone = wfItems.length > 0 && wfItems.every((it) => ['ATP', 'Unserviceable'].includes(it.in_process_status ?? ''));
  const anyReceived = wfItems.some((it) => ['Goods Received', 'ATP'].includes(it.in_process_status ?? ''));
  const itemIdx = allDone ? WORKFLOW_STEPS.indexOf('ATP') : anyReceived ? WORKFLOW_STEPS.indexOf('Goods Received') : -1;
  const activeIdx = orderIdx >= 0 ? Math.max(orderIdx, itemIdx) : orderIdx;
  const isDone = order.status === 'Completed' || order.status === 'Cancelled';
  const editable = canWrite && !isDone;

  const pt = data.putaway_task ?? null;
  const ptEditable =
    canWrite && !isDone && !!pt && (pt.task.status === 'Pending' || pt.task.status === 'In Progress');
  const hasTeam = !!(pt && (pt.task.forklift_operator_id || pt.task.checklist_partner_id));

  const palletCount = (item: ItemDetail) => data.item_pallet_counts?.[String(item.id)] ?? item.pallet ?? 0;

  // Each item with saved pallet locations renders as ONE row per pallet/location
  // (same product repeated) — mirroring the spreadsheet's per-bin item rows.
  const displayRows: { item: ItemDetail; pallet: PalletLocation | null }[] = data.items.flatMap((item): { item: ItemDetail; pallet: PalletLocation | null }[] => {
    const locs = (item.pallet_locations ?? []).filter((l) => l.location_code && String(l.location_code).trim());
    if (locs.length === 0) return [{ item, pallet: null }];
    return locs.map((pallet) => ({ item, pallet }));
  });

const headerActions = (
    <div className="flex items-center gap-2 flex-wrap">
      <Link
        to="/inbound"
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 border border-white/30 text-white text-sm font-semibold hover:bg-white/25"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>
      <WebBtn href={apiHref('print', 'inbound_receipt', { id: order.id })} label="Receipt" icon={<Printer className="w-4 h-4" />} />
      <WebBtn href={apiHref('print', 'putaway', { id: order.id })} label="Putaway" icon={<ClipboardList className="w-4 h-4" />} />
      {editable && order.status === 'Draft' && (
        <button
          onClick={advanceToDuesIn}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-60"
        >
          Advance to Dues In
        </button>
      )}
      {editable && order.status === 'Dues In' && (
        <button
          onClick={() => {
            setReceivedBy('');
            setReceivedDate(todayISO());
            setAdvanceOpen(true);
          }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-60"
        >
          Advance to Receiving
        </button>
      )}
      {editable && (
        <button
          onClick={completeOrder}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-60"
        >
          Complete
        </button>
      )}
      {editable && canAdmin && (
        <button
          onClick={repairLedger}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 border border-white/30 text-white text-sm font-semibold hover:bg-white/25 disabled:opacity-60"
        >
          Repair Ledger
        </button>
      )}
      {editable && (
        <ConfirmButton label="Delete Order" confirmText="Hapus order inbound ini?" onConfirm={deleteOrder} disabled={busy} />
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title={order.order_number}
        subtitle={`Order date: ${fmtDate(order.order_date)}`}
        actions={headerActions}
      />

      <Card title="Workflow">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1 overflow-x-auto py-1">
            {WORKFLOW_STEPS.map((s, i) => {
              const active = i <= activeIdx;
              return (
                <div key={s} className="flex items-center gap-1 flex-shrink-0">
                  <span
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap ${
                      i === activeIdx
                        ? 'bg-brand-600 text-white border-brand-600'
                        : active
                          ? 'bg-brand-50 text-brand-700 border-brand-200'
                          : 'bg-gray-50 text-gray-400 border-gray-200'
                    }`}
                  >
                    {s}
                  </span>
                  {i < WORKFLOW_STEPS.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
                </div>
              );
            })}
          </div>
          <StatusBadge status={activeIdx >= 0 ? WORKFLOW_STEPS[activeIdx] : order.status} />
        </div>
      </Card>

      <Card title="Order Information">
        <Grid cols={4}>
          <InfoItem label="Carrier" value={order.carrier_name} />
          <InfoItem label="PO Number" value={order.po_number} />
          <InfoItem label="Shipment No" value={order.shipment_no} />
          <InfoItem label="DO Number" value={order.do_number} />
          <InfoItem label="Container No" value={order.container_no} />
          <InfoItem label="Armada No" value={order.armada_no} />
          <InfoItem label="Production Date" value={fmtDate(order.production_date)} />
          <InfoItem label="Expected Date" value={fmtDate(order.expected_date)} />
          <InfoItem label="Received By" value={order.received_by_name} />
          <InfoItem label="Received Date" value={fmtDate(order.received_date)} />
          <InfoItem label="Created By" value={order.created_by_name} />
          <InfoItem label="OD Numbers" value={order.od_numbers} />
        </Grid>
        <div className="mt-4">
          <InfoItem label="Notes" value={order.notes} />
        </div>
      </Card>

      <Card
        title={`Items (${displayRows.length})`}
        actions={
          editable ? (
            <button
              onClick={openAddItem}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            >
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          ) : undefined
        }
      >
        {editable && (
          <div className="px-3 pt-3">
            <ScanInput onScan={handleScan} placeholder={`Scan SKU → ${putawayTarget ? `${putawayTarget.product_code || ''} → ${scanNextStatus}` : 'semua item selesai'}`} disabled={busy} className="max-w-md" />
            {putawayTarget && (
              <div className="text-[11px] text-gray-400 mt-1">
                Diproses: {putawayTarget.product_code || '—'} · {putawayTarget.product_name || ''} · {putawayTarget.batch_number || '—'}
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
        {data.items.length === 0 ? (
          <EmptyState message="Belum ada item" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Product</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">OD No</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">SO No</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Batch</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Pallet No</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Qty</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">UOM</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Actual</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Pallet</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Location</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Mfg Date</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Exp Date</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Process</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Stock</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  const item = row.item;
                  const pallet = row.pallet;
                  const rowQty = pallet ? Number(pallet.quantity ?? 0) : Number(item.quantity ?? 0);
                  const rowLoc = pallet ? pallet.location_code : (item.location || '—');
                  return (
                    <tr key={`${item.id}-${pallet ? pallet.pallet_seq : 0}`} className={`border-t border-gray-100 transition-colors ${scanMatchId === item.id ? 'bg-emerald-50 ring-2 ring-inset ring-emerald-300' : 'hover:bg-brand-50'}`}>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-gray-800">{item.product_code}</div>
                        <div className="text-[11px] text-gray-500 truncate max-w-[180px]">{item.product_name || ''}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{item.od_number || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{item.so_number || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{item.batch_number || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{item.pallet_no || (pallet ? `Pallet ${pallet.pallet_seq}` : '—')}</td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium text-right">{fmtNum(rowQty, 0)}</td>
                      <td className="px-3 py-2.5 text-gray-600">{item.uom || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium text-right">{fmtNum(rowQty, 0)}</td>
                      <td className="px-3 py-2.5 text-gray-700 font-medium text-right">{pallet ? 1 : fmtNum(palletCount(item), 0)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                        {item.cross_dock_outbound_order_id ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                              <ClipboardList className="w-3 h-3" /> CROSS-DOCK
                            </span>
                            <span className="text-[11px] text-violet-700">→ {item.cross_dock_order_number || item.cross_dock_outbound_order_id} @ STAGING</span>
                          </div>
                        ) : (
                          rowLoc
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{fmtDate(item.manufacture_date)}</td>
                      <td className="px-3 py-2.5 text-gray-600">{fmtDate(item.exp_date)}</td>
                      <td className="px-3 py-2.5">
                        <ItemStatusPill status={item.in_process_status} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={item.stock_status} />
                      </td>
                      <td className="px-3 py-2.5">
                        {editable ? (
                          <div className="flex items-center gap-1 flex-wrap justify-end">
                            <ActionBtn title="Edit Qty" onClick={() => openEditQty(item)}>
                              <Edit3 className="w-3.5 h-3.5" />
                            </ActionBtn>
                            <ActionBtn title="Edit Dates" onClick={() => openEditDates(item)}>
                              <CalendarDays className="w-3.5 h-3.5" />
                            </ActionBtn>
                            <ActionBtn title="Update Pallet No" onClick={() => openPalletNo(item)}>
                              <Boxes className="w-3.5 h-3.5" />
                            </ActionBtn>
                            <ActionBtn title="Assign Location" onClick={() => openLoc(item)}>
                              <MapPin className="w-3.5 h-3.5" />
                            </ActionBtn>
                            <ActionBtn title="Manage Pallet Locations" onClick={() => openPalletModal(item)}>
                              <Layers className="w-3.5 h-3.5" />
                            </ActionBtn>
                            <Select
                              value={item.in_process_status || ''}
                              onChange={(e) => updateItemStatus(item, e.target.value)}
                              className="!w-32 !py-1 !px-2 text-xs"
                            >
                              {ITEM_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </Select>
                            <ConfirmButton label="Delete" confirmText="Hapus item ini?" onConfirm={() => deleteItem(item)} />
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400">View only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data.putaway_task && (
        <Card
          title={`Putaway Task — ${data.putaway_task.task.task_number}`}
          actions={
            ptEditable ? (
              <div className="flex items-center gap-2">
                {hasTeam ? (
                  <>
                    <button
                      onClick={openTeamAssign}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                    >
                      <UsersRound className="w-3.5 h-3.5" /> Ubah Tim
                    </button>
                    <ConfirmButton label="Lepas Tim" confirmText="Hapus penugasan tim?" onConfirm={unassignTeam} variant="ghost" />
                  </>
                ) : (
                  <button
                    onClick={openTeamAssign}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                  >
                    <UsersRound className="w-3.5 h-3.5" /> Tugaskan Tim
                  </button>
                )}
              </div>
            ) : undefined
          }
        >
          <div className="flex items-center gap-3 flex-wrap mb-3 text-sm">
            <StatusBadge status={data.putaway_task.task.status} />
            <span className="text-gray-600">
              <span className="font-semibold">{data.putaway_task.task.done_count}</span>/
              {data.putaway_task.task.pallet_count} pallet selesai
            </span>
            <span className="text-gray-600">
              Forklift:{' '}
              <span className="font-semibold">{data.putaway_task.task.forklift_operator_name || 'Belum ditugaskan'}</span>
            </span>
            <span className="text-gray-600">
              Checklist (scan):{' '}
              <span className="font-semibold">{data.putaway_task.task.checklist_partner_name || 'Belum ditugaskan'}</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">LPN</th>
                  <th className="px-3 py-2">Produk</th>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Lokasi Tujuan</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.putaway_task.rows.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{row.lpn_code || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{row.product_code || '—'}</div>
                      <div className="text-[11px] text-gray-500">{row.product_name || ''}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{row.batch_number || '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {fmtNum(row.quantity)} {row.uom || ''}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{row.suggested_location || '—'}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canWrite && (
                        <button
                          onClick={() => printLpnLabel(row.id)}
                          disabled={labelBusy}
                          className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                          title="Cetak label LPN"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={teamModal} onClose={() => setTeamModal(false)} title="Tugaskan Tim Putaway" size="sm">
        <div className="space-y-4">
          <Field label="Forklift Operator" required>
            <Select value={teamFo} onChange={(e) => setTeamFo(e.target.value)}>
              <option value="">— Pilih operator —</option>
              {putawayUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.username}){u.department !== 'all' ? ` · ${u.department}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Checklist Partner (scan)" required>
            <Select value={teamCp} onChange={(e) => setTeamCp(e.target.value)}>
              <option value="">— Pilih partner —</option>
              {putawayUsers.map((u) => (
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
              onClick={submitTeamAssign}
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
      <Modal open={advanceOpen} onClose={() => setAdvanceOpen(false)} title="Advance to Receiving" size="sm">
        <div className="space-y-4">
          <Field label="Received By" required>
            <Select value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)}>
              <option value="">Pilih penerima...</option>
              {(data.users || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.username}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Received Date" required>
            <TextInput type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdvanceOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold">
              Batal
            </button>
            <button
              onClick={advanceToReceiving}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-semibold disabled:opacity-60"
            >
              {busy ? 'Menyimpan...' : 'Advance'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editQtyItem} onClose={() => setEditQtyItem(null)} title="Edit Quantity" size="sm">
        {editQtyItem && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              <span className="font-semibold text-gray-700">{editQtyItem.product_code}</span> — {editQtyItem.product_name}
            </div>
            <Field label="Quantity" required>
              <TextInput type="number" min={0} value={qtyValue} onChange={(e) => setQtyValue(e.target.value)} autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditQtyItem(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold">
                Batal
              </button>
              <button
                onClick={saveQty}
                disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-semibold disabled:opacity-60"
              >
                Simpan
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!editDatesItem} onClose={() => setEditDatesItem(null)} title="Edit Dates" size="sm">
        {editDatesItem && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              <span className="font-semibold text-gray-700">{editDatesItem.product_code}</span> — {editDatesItem.product_name}
            </div>
            <Field label="Manufacture Date">
              <TextInput type="date" value={mfgValue} onChange={(e) => setMfgValue(e.target.value)} />
            </Field>
            <Field label="Expiry Date">
              <TextInput type="date" value={expValue} onChange={(e) => setExpValue(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditDatesItem(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold">
                Batal
              </button>
              <button
                onClick={saveDates}
                disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-semibold disabled:opacity-60"
              >
                Simpan
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!palletNoItem} onClose={() => setPalletNoItem(null)} title="Update Pallet No" size="sm">
        {palletNoItem && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              <span className="font-semibold text-gray-700">{palletNoItem.product_code}</span> — {palletNoItem.product_name}
            </div>
            <Field label="Pallet No">
              <TextInput value={palletNoValue} onChange={(e) => setPalletNoValue(e.target.value)} autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPalletNoItem(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold">
                Batal
              </button>
              <button
                onClick={savePalletNo}
                disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-semibold disabled:opacity-60"
              >
                Simpan
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!locItem} onClose={() => setLocItem(null)} title="Assign Location" size="sm">
        {locItem && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              <span className="font-semibold text-gray-700">{locItem.product_code}</span> — {locItem.product_name}
            </div>
            <Field label="Location" required>
              <TextInput list="inbound-locations" value={locValue} onChange={(e) => setLocValue(e.target.value)} placeholder="A-01-01" autoFocus />
              <datalist id="inbound-locations">
                {(data.locations || []).map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setLocItem(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold">
                Batal
              </button>
              <button
                onClick={saveLoc}
                disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-semibold disabled:opacity-60"
              >
                Simpan
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!palletItem} onClose={() => setPalletItem(null)} title="Manage Pallet Locations" size="lg">
        {palletItem && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              <span className="font-semibold text-gray-700">{palletItem.product_code}</span> — {palletItem.product_name}
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_90px_40px] gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 px-1">
                <span>Location Code</span>
                <span>Quantity</span>
                <span>Is Full</span>
                <span></span>
              </div>
              {palletRows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_90px_40px] gap-2 items-center">
                  <TextInput value={r.location_code} onChange={(e) => updatePalletRow(i, { location_code: e.target.value })} placeholder="A-01-01" />
                  <TextInput type="number" min={0} value={r.quantity} onChange={(e) => updatePalletRow(i, { quantity: e.target.value })} />
                  <input
                    type="checkbox"
                    checked={r.is_full}
                    onChange={(e) => updatePalletRow(i, { is_full: e.target.checked })}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <button type="button" onClick={() => removePalletRow(i)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addPalletRow}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100"
              >
                <Plus className="w-3.5 h-3.5" /> Add Row
              </button>
              <button
                type="button"
                onClick={suggestPallet}
                disabled={palletSuggesting || !palletItem?.product_id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" /> {palletSuggesting ? 'Mencari...' : 'Saran Lokasi (Putaway)'}
              </button>
            </div>
            {palletSuggestMsg && <div className="text-xs text-gray-500">{palletSuggestMsg}</div>}
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
              <button onClick={() => setPalletItem(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold">
                Batal
              </button>
              <button
                onClick={savePallet}
                disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-semibold disabled:opacity-60"
              >
                {busy ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={addItemOpen} onClose={() => setAddItemOpen(false)} title="Add Item" size="xl">
        <div className="space-y-4">
          <Field label="Product" required>
            <ProductSearch
              selected={addItem.product_id ? { id: addItem.product_id, code: addItem.product_code, name: addItem.product_name } : null}
              onSelect={(p) =>
                setAddItem((f) => ({ ...f, product_id: p.id, product_code: p.product_code, product_name: p.product_name, uom: p.uom || '' }))
              }
              onClear={() => setAddItem((f) => ({ ...f, product_id: null, product_code: '', product_name: '', uom: '' }))}
              autoFocus
            />
          </Field>
          <Grid cols={3}>
            <Field label="Batch Number">
              <TextInput value={addItem.batch_number} onChange={(e) => setAddItem((f) => ({ ...f, batch_number: e.target.value }))} />
            </Field>
            <Field label="OD Number">
              <TextInput value={addItem.od_number} onChange={(e) => setAddItem((f) => ({ ...f, od_number: e.target.value }))} />
            </Field>
            <Field label="SO Number">
              <TextInput value={addItem.so_number} onChange={(e) => setAddItem((f) => ({ ...f, so_number: e.target.value }))} />
            </Field>
          </Grid>
          <Grid cols={3}>
            <Field label="Quantity" required>
              <TextInput type="number" min={0} value={addItem.quantity} onChange={(e) => setAddItem((f) => ({ ...f, quantity: e.target.value }))} />
            </Field>
            <Field label="UOM">
              <TextInput value={addItem.uom} onChange={(e) => setAddItem((f) => ({ ...f, uom: e.target.value }))} />
            </Field>
            <Field label="In Process Status">
              <Select value={addItem.in_process_status} onChange={(e) => setAddItem((f) => ({ ...f, in_process_status: e.target.value }))}>
                {ITEM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Manufacture Date">
              <TextInput type="date" value={addItem.manufacture_date} onChange={(e) => setAddItem((f) => ({ ...f, manufacture_date: e.target.value }))} />
            </Field>
            <Field label="Expiry Date">
              <TextInput type="date" value={addItem.exp_date} onChange={(e) => setAddItem((f) => ({ ...f, exp_date: e.target.value }))} />
            </Field>
          </Grid>

          <Field
            label="Cross-dock ke Outbound Order"
            hint={addItem.cross_dock_outbound_order_id ? 'Item ini TIDAK melalui putaway normal — langsung distage di STAGING untuk outbound tsb.' : 'Opsional. Item akan dilewati dari FEFO/putaway biasa.'}
          >
            <Select
              value={addItem.cross_dock_outbound_order_id ? String(addItem.cross_dock_outbound_order_id) : ''}
              onChange={(e) => setAddItem((f) => ({ ...f, cross_dock_outbound_order_id: e.target.value ? Number(e.target.value) : null }))}
            >
              <option value="">Tidak cross-dock (putaway normal)</option>
              {(data.cross_dock_orders || []).map((o: any) => (
                <option key={o.id} value={o.id}>
                  {o.order_number} · {o.display_no || o.so_number || o.do_number} · {o.customer_name || ''}
                </option>
              ))}
            </Select>
          </Field>

          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">Pallet Locations</h4>
            <div className="space-y-2">
              {addLocations.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_90px_40px] gap-2 items-center">
                  <TextInput value={r.location_code} onChange={(e) => updateAddLoc(i, { location_code: e.target.value })} placeholder="A-01-01" />
                  <TextInput type="number" min={0} value={r.quantity} onChange={(e) => updateAddLoc(i, { quantity: e.target.value })} />
                  <input
                    type="checkbox"
                    checked={r.is_full}
                    onChange={(e) => updateAddLoc(i, { is_full: e.target.checked })}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <button type="button" onClick={() => removeAddLoc(i)} className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAddLocations((arr) => [...arr, { location_code: '', quantity: '', is_full: true }])}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100"
              >
                <Plus className="w-3.5 h-3.5" /> Add Row
              </button>
              <button
                type="button"
                onClick={suggestAddLocations}
                disabled={addSuggesting}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" /> {addSuggesting ? 'Mencari...' : 'Saran Lokasi (Putaway)'}
              </button>
            </div>
            {addSuggestMsg && <div className="text-xs text-gray-500">{addSuggestMsg}</div>}
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button onClick={() => setAddItemOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold">
              Batal
            </button>
            <button
              onClick={saveAddItem}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-semibold disabled:opacity-60"
            >
              {busy ? 'Menyimpan...' : 'Simpan Item'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
