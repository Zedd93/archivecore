import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PRICING_SERVICES } from '@archivecore/shared';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';
import { getApiErrorMessage } from '@/utils/apiError';
import toast from 'react-hot-toast';
import BillingEventsPanel from './BillingEventsPanel';

type RateValues = Record<string, string>;

interface PriceListItem {
  id: string;
  serviceCode: string;
  serviceName: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  minimumQuantity: string | null;
  isActive: boolean;
}

interface PriceList {
  id: string;
  name: string;
  currency: string;
  validFrom: string;
  validTo: string | null;
  minimumMonthlyFee: string | null;
  status: 'draft' | 'active' | 'archived';
  items: PriceListItem[];
}

const today = () => new Date().toISOString().slice(0, 10);

export default function PricingPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PriceList | null>(null);
  const [name, setName] = useState('');
  const [validFrom, setValidFrom] = useState(today);
  const [minimumMonthlyFee, setMinimumMonthlyFee] = useState('');
  const [rates, setRates] = useState<RateValues>({});

  const { data: tenants = [], isLoading: tenantsLoading } = useQuery({
    queryKey: ['pricing-tenants'],
    queryFn: async () => {
      const { data } = await api.get('/tenants', { params: { page: 1, limit: 500, isActive: true } });
      return data.data || [];
    },
  });

  useEffect(() => {
    if (!tenantId && tenants.length > 0) setTenantId(tenants[0].id);
  }, [tenantId, tenants]);

  const { data: priceLists = [], isLoading: priceListsLoading } = useQuery<PriceList[]>({
    queryKey: ['price-lists', tenantId],
    queryFn: async () => {
      const { data } = await api.get(`/pricing/tenants/${tenantId}`);
      return data.data || [];
    },
    enabled: Boolean(tenantId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['price-lists', tenantId] });

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => editing
      ? api.put(`/pricing/${editing.id}`, payload)
      : api.post(`/pricing/tenants/${tenantId}`, payload),
    onSuccess: async () => {
      toast.success(t(editing ? 'admin.pricing.updated' : 'admin.pricing.created'));
      setShowForm(false);
      setEditing(null);
      await invalidate();
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, t('common.genericError'))),
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/pricing/${id}/activate`),
    onSuccess: async () => {
      toast.success(t('admin.pricing.activated'));
      await invalidate();
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, t('common.genericError'))),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/pricing/${id}`),
    onSuccess: async () => {
      toast.success(t('admin.pricing.deleted'));
      await invalidate();
    },
    onError: (error: any) => toast.error(getApiErrorMessage(error, t('common.genericError'))),
  });

  const sortedPriceLists = useMemo(() => {
    const statusOrder = { active: 0, draft: 1, archived: 2 };
    return [...priceLists].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]
      || b.validFrom.localeCompare(a.validFrom));
  }, [priceLists]);

  const resetForm = () => {
    setEditing(null);
    setName(`${t('admin.pricing.defaultName')} ${today()}`);
    setValidFrom(today());
    setMinimumMonthlyFee('');
    setRates({});
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (priceList: PriceList) => {
    setEditing(priceList);
    setName(priceList.name);
    setValidFrom(priceList.validFrom.slice(0, 10));
    setMinimumMonthlyFee(priceList.minimumMonthlyFee || '');
    setRates(Object.fromEntries(priceList.items.map((item) => [item.serviceCode, item.unitPrice])));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const submitForm = (event: React.FormEvent) => {
    event.preventDefault();
    const items = PRICING_SERVICES
      .filter((service) => rates[service.code] !== undefined && rates[service.code] !== '')
      .map((service) => ({
        serviceCode: service.code,
        serviceName: t(`admin.pricing.services.${service.code}`, { defaultValue: service.defaultName }),
        unit: service.unit,
        unitPrice: Number(rates[service.code]),
        vatRate: 23,
        isActive: true,
      }));

    if (items.length === 0) {
      toast.error(t('admin.pricing.rateRequired'));
      return;
    }

    saveMutation.mutate({
      name: name.trim(),
      currency: 'PLN',
      validFrom,
      minimumMonthlyFee: minimumMonthlyFee === '' ? null : Number(minimumMonthlyFee),
      items,
    });
  };

  const formatMoney = (value: string | number | null) => new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'PLN',
  }).format(Number(value || 0));

  const formatDate = (value: string | null) => value
    ? new Date(value).toLocaleDateString(i18n.language)
    : '—';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.pricing.title')}</h1>
          <p className="text-sm text-gray-500">{t('admin.pricing.subtitle')}</p>
        </div>
        <button type="button" onClick={openCreate} disabled={!tenantId} className="btn-primary w-full sm:w-auto">
          <Plus size={16} /> {t('admin.pricing.new')}
        </button>
      </div>

      <div className="card">
        <label htmlFor="pricing-tenant" className="label-text">{t('admin.pricing.tenant')}</label>
        <select
          id="pricing-tenant"
          value={tenantId}
          onChange={(event) => setTenantId(event.target.value)}
          disabled={tenantsLoading}
          className="input-field mt-1"
        >
          <option value="">{t('admin.pricing.selectTenant')}</option>
          {tenants.map((tenant: any) => (
            <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.shortCode})</option>
          ))}
        </select>
      </div>

      {priceListsLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-primary-600" size={32} /></div>
      ) : sortedPriceLists.length === 0 ? (
        <div className="card py-12 text-center text-gray-500">
          <Receipt size={40} className="mx-auto mb-3 text-gray-300" />
          {t('admin.pricing.empty')}
        </div>
      ) : (
        <div className="space-y-4">
          {sortedPriceLists.map((priceList) => (
            <div key={priceList.id} className={`card ${priceList.status === 'active' ? 'ring-2 ring-green-200' : ''}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">{priceList.name}</h2>
                    <span className={priceList.status === 'active' ? 'badge-green' : priceList.status === 'draft' ? 'badge-blue' : 'badge-gray'}>
                      {t(`admin.pricing.status.${priceList.status}`)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    {t('admin.pricing.validFrom')}: {formatDate(priceList.validFrom)}
                    {priceList.validTo ? ` · ${t('admin.pricing.validTo')}: ${formatDate(priceList.validTo)}` : ''}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {t('admin.pricing.minimumMonthlyFee')}: {priceList.minimumMonthlyFee ? formatMoney(priceList.minimumMonthlyFee) : t('admin.pricing.none')}
                  </p>
                </div>

                {priceList.status === 'draft' && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => openEdit(priceList)} className="btn-secondary text-sm">
                      <Pencil size={15} /> {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t('admin.pricing.activateConfirm'))) activateMutation.mutate(priceList.id);
                      }}
                      disabled={activateMutation.isPending}
                      className="btn-primary text-sm"
                    >
                      <CheckCircle2 size={15} /> {t('admin.pricing.activate')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t('admin.pricing.deleteConfirm'))) deleteMutation.mutate(priceList.id);
                      }}
                      disabled={deleteMutation.isPending}
                      className="btn-secondary text-sm text-red-600"
                    >
                      <Trash2 size={15} /> {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                      <th className="px-2 py-2">{t('admin.pricing.service')}</th>
                      <th className="px-2 py-2">{t('admin.pricing.unit')}</th>
                      <th className="px-2 py-2 text-right">{t('admin.pricing.netPrice')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {priceList.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-2 py-2 text-gray-900">{t(`admin.pricing.services.${item.serviceCode}`, { defaultValue: item.serviceName })}</td>
                        <td className="px-2 py-2 text-gray-500">{t(`admin.pricing.units.${item.unit}`, { defaultValue: item.unit })}</td>
                        <td className="px-2 py-2 text-right font-medium">{formatMoney(item.unitPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {tenantId && <BillingEventsPanel tenantId={tenantId} />}

      <Modal isOpen={showForm} onClose={closeForm} title={t(editing ? 'admin.pricing.editTitle' : 'admin.pricing.createTitle')} size="xl">
        <form onSubmit={submitForm} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="pricing-name" className="label-text">{t('admin.pricing.name')}</label>
              <input id="pricing-name" value={name} onChange={(event) => setName(event.target.value)} className="input-field" required maxLength={255} />
            </div>
            <div>
              <label htmlFor="pricing-valid-from" className="label-text">{t('admin.pricing.validFrom')}</label>
              <input id="pricing-valid-from" type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className="input-field" required />
            </div>
          </div>

          <div>
            <label htmlFor="pricing-minimum-fee" className="label-text">{t('admin.pricing.minimumMonthlyFee')}</label>
            <input id="pricing-minimum-fee" type="number" min="0" step="0.01" value={minimumMonthlyFee} onChange={(event) => setMinimumMonthlyFee(event.target.value)} className="input-field sm:w-64" placeholder="0,00" />
          </div>

          <div>
            <h3 className="font-medium text-gray-900">{t('admin.pricing.rates')}</h3>
            <p className="mt-1 text-xs text-gray-500">{t('admin.pricing.ratesHint')}</p>
            <div className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
              {PRICING_SERVICES.map((service) => (
                <div key={service.code} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_180px] sm:items-center">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{t(`admin.pricing.services.${service.code}`, { defaultValue: service.defaultName })}</div>
                    <div className="text-xs text-gray-500">{t(`admin.pricing.units.${service.unit}`)}</div>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates[service.code] || ''}
                      onChange={(event) => setRates((current) => ({ ...current, [service.code]: event.target.value }))}
                      className="input-field pr-12 text-right"
                      aria-label={t(`admin.pricing.services.${service.code}`, { defaultValue: service.defaultName })}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">PLN</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={closeForm} className="btn-secondary">{t('common.cancel')}</button>
            <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
              {t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
