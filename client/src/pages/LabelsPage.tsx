import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { QrCode, Printer, Camera, Loader2, ScanLine } from 'lucide-react';
import toast from 'react-hot-toast';
import BoxPicker from '@/components/ui/BoxPicker';

interface SelectedBox {
  id: string;
  boxNumber: string;
}

export default function LabelsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'generate' | 'scan'>('generate');
  const [selectedSingleBox, setSelectedSingleBox] = useState<SelectedBox[]>([]);
  const [selectedBatchBoxes, setSelectedBatchBoxes] = useState<SelectedBox[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [isScanning, setIsScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Templates
  const { data: templates } = useQuery({
    queryKey: ['label-templates'],
    queryFn: async () => {
      const { data } = await api.get('/labels/templates');
      return data.data;
    },
  });

  const handleGenerateSingle = async () => {
    const box = selectedSingleBox[0];
    if (!box) return;
    setIsGenerating(true);
    try {
      const response = await api.get(`/labels/box/${encodeURIComponent(box.id)}`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank');
      toast.success(t('common.success'));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('boxes.labelError'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateBatch = async () => {
    if (selectedBatchBoxes.length === 0) return;
    setIsGenerating(true);
    try {
      const response = await api.post('/labels/batch', { boxIds: selectedBatchBoxes.map((box) => box.id) }, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank');
      toast.success(t('common.success'));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('common.genericError'));
    } finally {
      setIsGenerating(false);
    }
  };

  const startScanner = async () => {
    try {
      setIsScanning(true);
      setScanResult(null);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      toast.error(t('labels.cameraError'));
      setIsScanning(false);
    }
  };

  const stopScanner = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsScanning(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('labels.title')}</h1>
        <p className="text-sm text-gray-500">{t('labels.subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => { setActiveTab('generate'); stopScanner(); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'generate' ? 'bg-white shadow-sm text-primary-700' : 'text-gray-600 hover:text-gray-900'}`}
        >
          <Printer size={16} className="inline mr-2" /> {t('labels.generateTab')}
        </button>
        <button
          onClick={() => setActiveTab('scan')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'scan' ? 'bg-white shadow-sm text-primary-700' : 'text-gray-600 hover:text-gray-900'}`}
        >
          <ScanLine size={16} className="inline mr-2" /> {t('labels.scanTab')}
        </button>
      </div>

      {activeTab === 'generate' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Single label */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <QrCode size={20} className="text-primary-600" />
              {t('labels.singleLabel')}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="label-text">{t('labels.boxId')}</label>
                <BoxPicker
                  value={selectedSingleBox}
                  onChange={(boxes) => setSelectedSingleBox(boxes.slice(-1))}
                  placeholder={t('labels.boxSearchPlaceholder')}
                />
              </div>
              <button
                onClick={handleGenerateSingle}
                disabled={selectedSingleBox.length === 0 || isGenerating}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                {t('labels.generatePdf')}
              </button>
            </div>
          </div>

          {/* Batch */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Printer size={20} className="text-primary-600" />
              {t('labels.bulkPrint')}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="label-text">{t('labels.boxIds')}</label>
                <BoxPicker
                  value={selectedBatchBoxes}
                  onChange={setSelectedBatchBoxes}
                  placeholder={t('labels.boxSearchPlaceholder')}
                />
              </div>
              <button
                onClick={handleGenerateBatch}
                disabled={selectedBatchBoxes.length === 0 || isGenerating}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                {t('labels.generateA4')}
              </button>
            </div>
          </div>

          {/* Templates */}
          <div className="card lg:col-span-2">
            <h2 className="text-lg font-semibold mb-4">{t('labels.templates')}</h2>
            {templates?.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {templates.map((tpl: any) => (
                  <div key={tpl.id} className={`p-4 border rounded-xl ${tpl.isDefault ? 'border-primary-300 bg-primary-50' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{tpl.name}</span>
                      {tpl.isDefault && <span className="badge-blue text-xs">{t('labels.defaultTemplate')}</span>}
                    </div>
                    <div className="text-xs text-gray-500 space-y-1">
                      <div>{t('labels.dimensions')} {tpl.widthMm} × {tpl.heightMm} mm</div>
                      <div>{t('labels.qrSize')} {tpl.qrSizeMm} mm</div>
                      <div>{t('labels.correction')} {tpl.qrErrorLevel}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">{t('labels.noTemplates')}</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'scan' && (
        <div className="card max-w-xl">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Camera size={20} className="text-primary-600" />
            {t('labels.scannerTitle')}
          </h2>
          <div className="space-y-4">
            {!isScanning ? (
              <button onClick={startScanner} className="btn-primary w-full flex items-center justify-center gap-2">
                <Camera size={16} /> {t('labels.startCamera')}
              </button>
            ) : (
              <>
                <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                  <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                  <div className="absolute inset-0 border-2 border-primary-500/50 rounded-xl" />
                </div>
                <button onClick={stopScanner} className="btn-secondary w-full">
                  {t('labels.stopCamera')}
                </button>
              </>
            )}
            <div>
              <label htmlFor="label-scan-manualCode" className="label-text">{t('labels.manualInput')}</label>
              <input
                id="label-scan-manualCode"
                type="text"
                className="input-field font-mono"
                placeholder="AC:DEMO:K-2024-00001:A1B2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value;
                    if (val.startsWith('AC:')) {
                      window.location.href = `/search?q=${encodeURIComponent(val)}`;
                    }
                  }
                }}
              />
              <p className="text-xs text-gray-400 mt-1">{t('labels.format')}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
