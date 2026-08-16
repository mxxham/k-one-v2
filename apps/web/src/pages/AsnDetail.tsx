import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Edit3, Trash2, ArrowRightCircle, Printer } from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtNum } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import Spinner from '@/components/Spinner';
import Modal from '@/components/Modal';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, Select, TextArea, Grid } from '@/components/Field';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';

interface AsnItem {
  id: number;
  product_id: number;
  product_code: string;
  product_name: string;
  expected_qty: number;
  uom?: string;
  batch_number?: string;
  exp_date?: string;
}

interface LinkedInbound {
  id: number;
  order_number: string;
  status: string;
  order_date?: string;
}

interface AsnDetailData {
  asn: {
    id: number;
    asn_number: string;
    supplier_name?: string;
    supplier_reference?: string;
    expected_arrival_date?: string;
    status: string;
    notes?: string;
    created_by_name?: string;
    created_at: string;
    updated_at?: string;
    items: AsnItem[];
  };
  inbound_orders: LinkedInbound[];
}

const ASN_STATUSES = ['Pending', 'Received', 'Cancelled'];

function InfoItem({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm font-medium text-gray-800 mt-0.5 break-words">{value || '—'}</div>
    </div>
  );
}

export default function AsnDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { canWrite } = useAuth();

  const [data, setData] = useState<AsnDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ supplier_name: '', supplier_reference: '', expected_arrival_date: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('asn', 'detail', { params: { id } });
      setData(res as unknown as AsnDetailData);
    } catch (e: any) {
      toast('error', e.message || 'Gagal memuat ASN');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = () => {
    if (!data) return;
    setForm({
      supplier_name: data.asn.supplier_name || '',
      supplier_reference: data.asn.supplier_reference || '',
      expected_arrival_date: data.asn.expected_arrival_date || '',
      notes: data.asn.notes || '',
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    setSaving(true);
    try {
      await api('asn', 'update', {
        body: {
          id: data!.asn.id,
          supplier_name: form.supplier_name || undefined,
          supplier_reference: form.supplier_reference || undefined,
          expected_arrival_date: form.expected_arrival_date || undefined,
          notes: form.notes || undefined,
        },
      });
      toast('success', 'ASN berhasil diperbarui');
      setEditOpen(false);
      load();
    } catch (e: any) {
      toast('error', e.message || 'Gagal memperbarui ASN');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    try {
      await api('asn', 'cancel', { body: { id: data!.asn.id } });
      toast('success', 'ASN dibatalkan');
      load();
    } catch (e: any) {
      toast('error', e.message || 'Gagal membatalkan ASN');
    }
  };

  const createInbound = () => {
    navigate(`/inbound?asn_id=${data!.asn.id}`);
  };

  if (loading) return <Spinner label="Loading ASN..." />;
  if (!data) return <EmptyState message="ASN tidak ditemukan" />;

  const { asn } = data;
  const totalQty = (asn.items || []).reduce((s, i) => s + Number(i.expected_qty || 0), 0);

  return (
    <div>
      <PageHeader
        title={asn.asn_number}
        subtitle="Advance Shipping Notice"
        actions={
          <>
            <Link to="/asn" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/15 text-white text-sm font-semibold hover:bg-white/25">
              <ArrowLeft className="w-4 h-4" /> Back
            </Link>
            <a
              href={apiHref('export', 'asn')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/15 text-white text-sm font-semibold hover:bg-white/25"
            >
              <Printer className="w-4 h-4" /> Print
            </a>
            {canWrite && (
              <>
                {asn.status === 'Pending' && (
                  <button
                    onClick={createInbound}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 shadow"
                  >
                    <ArrowRightCircle className="w-4 h-4" /> Create Inbound
                  </button>
                )}
                <button
                  onClick={openEdit}
                  disabled={asn.status !== 'Pending'}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/15 text-white text-sm font-semibold hover:bg-white/25 disabled:opacity-40"
                >
                  <Edit3 className="w-4 h-4" /> Edit
                </button>
                <ConfirmButton
                  title="Cancel ASN"
                  label="Cancel ASN"
                  onConfirm={handleCancel}
                  disabled={asn.status === 'Received' || asn.status === 'Cancelled'}
                >
                  <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/15 text-white text-sm font-semibold hover:bg-white/25 disabled:opacity-40">
                    <Trash2 className="w-4 h-4" /> Cancel
                  </button>
                </ConfirmButton>
              </>
            )}
          </>
        }
      />

      <Card title="ASN Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <InfoItem label="Status" value={asn.status} />
          <InfoItem label="Supplier Name" value={asn.supplier_name} />
          <InfoItem label="Supplier Reference" value={asn.supplier_reference} />
          <InfoItem label="Expected Arrival" value={fmtDate(asn.expected_arrival_date)} />
          <InfoItem label="Total Items" value={`${fmtNum(asn.items.length, 0)}`} />
          <InfoItem label="Total Expected Qty" value={`${fmtNum(totalQty, 0)}`} />
          <InfoItem label="Created By" value={asn.created_by_name} />
          <InfoItem label="Created At" value={fmtDateTime(asn.created_at)} />
          <InfoItem label="Notes" value={asn.notes} />
        </div>
      </Card>

      <Card title="Expected Items">
        {asn.items.length === 0 ? (
          <EmptyState message="Belum ada item" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Product</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Product Name</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold text-right">Expected Qty</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">UOM</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Batch / Lot</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Expiry Date</th>
                </tr>
              </thead>
              <tbody>
                {asn.items.map((it) => (
                  <tr key={it.id} className="border-t border-gray-100 hover:bg-brand-50">
                    <td className="px-3 py-2.5 font-semibold text-brand-700">{it.product_code}</td>
                    <td className="px-3 py-2.5 text-gray-600">{it.product_name}</td>
                    <td className="px-3 py-2.5 text-gray-700 font-medium text-right">{fmtNum(it.expected_qty, 0)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{it.uom || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{it.batch_number || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{fmtDate(it.exp_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Linked Inbound Orders">
        {data.inbound_orders.length === 0 ? (
          <EmptyState message="Belum ada inbound yang dibuat dari ASN ini" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Order No</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Order Date</th>
                  <th className="px-3 py-2.5 bg-brand-50 text-brand-700 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.inbound_orders.map((o) => (
                  <tr key={o.id} className="border-t border-gray-100 hover:bg-brand-50">
                    <td className="px-3 py-2.5">
                      <Link to={`/inbound/${o.id}`} className="font-semibold text-brand-700 hover:underline">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{fmtDate(o.order_date)}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit ASN">
        <div className="space-y-4">
          <Grid cols={2}>
            <Field label="Supplier Name" required>
              <TextInput value={form.supplier_name} onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))} />
            </Field>
            <Field label="Supplier Reference">
              <TextInput value={form.supplier_reference} onChange={(e) => setForm((f) => ({ ...f, supplier_reference: e.target.value }))} />
            </Field>
          </Grid>
          <Field label="Expected Arrival Date">
            <TextInput type="date" value={form.expected_arrival_date} onChange={(e) => setForm((f) => ({ ...f, expected_arrival_date: e.target.value }))} />
          </Field>
          <Field label="Notes">
            <TextArea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button onClick={() => setEditOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-semibold">
              Batal
            </button>
            <button onClick={handleEdit} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-semibold disabled:opacity-60">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}