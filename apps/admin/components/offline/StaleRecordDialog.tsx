'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { CONFLICT_MESSAGE } from '@/lib/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Re-load the record/list from the server. */
  onReload: () => Promise<void> | void;
  /** e.g. "product", "order". */
  what?: string;
}

/**
 * Shown when the server refuses a save with 409 CONFLICT (someone else
 * changed the record since it was opened). Never retries silently — the
 * operator reloads the latest version and re-applies their change.
 */
export default function StaleRecordDialog({ isOpen, onClose, onReload, what = 'record' }: Props) {
  const [reloading, setReloading] = useState(false);
  const reload = async () => {
    setReloading(true);
    try {
      await onReload();
      onClose();
    } finally {
      setReloading(false);
    }
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={reloading ? () => undefined : onClose}
      title="Someone else changed this"
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={reloading}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:border-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={reload}
            disabled={reloading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand-gold hover:bg-brand-gold/90 text-black transition-colors disabled:opacity-50"
          >
            {reloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {reloading ? 'Reloading…' : 'Reload latest'}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" aria-hidden />
        <div className="space-y-2 text-sm text-foreground">
          <p>{CONFLICT_MESSAGE}</p>
          <p className="text-muted-foreground">
            Reload the latest version of this {what}, check what changed, then make your change again.
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** `const stale = useStaleRecordDialog(); … stale.open(reloadFn); … {stale.dialog}` */
export function useStaleRecordDialog(what?: string) {
  const [reloader, setReloader] = useState<null | (() => Promise<void> | void)>(null);
  const open = useCallback((onReload: () => Promise<void> | void) => setReloader(() => onReload), []);
  const close = useCallback(() => setReloader(null), []);
  const dialog = (
    <StaleRecordDialog isOpen={reloader !== null} onClose={close} onReload={() => reloader?.()} what={what} />
  );
  return { open, close, dialog };
}
