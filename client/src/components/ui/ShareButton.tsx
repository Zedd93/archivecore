import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';
import { Share2, Copy, Check, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface ShareButtonProps {
  entityType: 'box' | 'order' | 'hr' | 'transfer_list';
  entityId: string;
  className?: string;
}

export default function ShareButton({ entityType, entityId, className = '' }: ShareButtonProps) {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [expiry, setExpiry] = useState(7);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/share-links', {
        entityType,
        entityId,
        recipientEmail: email || undefined,
        expiresInDays: expiry,
      });
      const url = res.data.shareUrl || `${window.location.origin}/share/${res.data.token}`;
      setShareUrl(url);
      toast.success(t('share.linkGenerated'));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('share.shareError'));
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, email, expiry, t]);

  const handleCopy = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success(t('share.linkCopied'));
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl, t]);

  const handleClose = useCallback(() => {
    setShowModal(false);
    setShareUrl(null);
    setEmail('');
    setExpiry(7);
    setCopied(false);
  }, []);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`btn-secondary flex items-center gap-2 ${className}`}
      >
        <Share2 size={16} />
        {t('share.shareButton')}
      </button>

      <Modal isOpen={showModal} onClose={handleClose} title={t('share.shareModalTitle')}>
        <div className="space-y-4">
          {!shareUrl ? (
            <>
              <div>
                <label htmlFor="share-recipientEmail" className="label-text">{t('share.recipientEmail')}</label>
                <input
                  id="share-recipientEmail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder="jan@firma.pl"
                />
              </div>
              <div>
                <label htmlFor="share-expiresInDays" className="label-text">{t('share.expiresInDays')}</label>
                <select
                  id="share-expiresInDays"
                  value={expiry}
                  onChange={(e) => setExpiry(Number(e.target.value))}
                  className="input-field"
                >
                  <option value={1}>1</option>
                  <option value={3}>3</option>
                  <option value={7}>7</option>
                  <option value={14}>14</option>
                  <option value={30}>30</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button onClick={handleClose} className="btn-secondary">{t('common.cancel')}</button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="btn-primary flex items-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
                  {loading ? t('share.generating') : t('share.generateLink')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-2">{t('share.copyLink')}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="input-field text-xs font-mono flex-1"
                  />
                  <button
                    onClick={handleCopy}
                    className="btn-primary flex items-center gap-2 shrink-0"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? '✓' : t('share.copyLink')}
                  </button>
                </div>
              </div>
              <div className="flex justify-end pt-4 border-t">
                <button onClick={handleClose} className="btn-secondary">{t('common.close')}</button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
