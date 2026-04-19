'use client';

import { useState, useRef } from 'react';
import { X, Upload, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { adminApi } from '@/lib/api';

interface ImportResult {
  created: number;
  failed: number;
  total: number;
  errors: { row: number; field?: string; message: string }[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ImportProductsModal({ isOpen, onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    if (uploading) return;
    setFile(null);
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
    if (result && result.created > 0) onSuccess();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.csv')) {
      setError('Only .csv files are accepted');
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      setError('File size must be under 5MB');
      return;
    }
    setFile(selected);
    setError('');
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const res = await adminApi.bulkImportProducts(file);
      setResult(res);
      if (res.created > 0 && res.failed === 0) {
        setTimeout(() => {
          handleClose();
        }, 2000);
      }
    } catch (err: any) {
      setError(err?.message || 'Import failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[hsl(var(--card))] rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-[hsl(var(--border))]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-brand-gold" />
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Import Products from CSV</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {!result && (
            <>
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 text-sm text-blue-800 dark:text-blue-300">
                <p className="font-medium mb-1">Before you import:</p>
                <ul className="list-disc pl-5 space-y-0.5 text-xs">
                  <li>Download the template first to see the required format</li>
                  <li>Make sure categories exist in your system — use the category <strong>slug</strong></li>
                  <li>Required columns: <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">name</code>, <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">description</code>, <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">price</code>, <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">categorySlug</code></li>
                  <li>Maximum 500 rows per file, 5MB max</li>
                </ul>
              </div>

              {/* File picker */}
              <div>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-2">
                  Select CSV File
                </label>
                <div className="relative border-2 border-dashed border-[hsl(var(--border))] rounded-lg p-6 hover:border-brand-gold transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={uploading}
                  />
                  <div className="text-center">
                    <Upload className="w-8 h-8 mx-auto text-[hsl(var(--muted-foreground))] mb-2" />
                    {file ? (
                      <>
                        <p className="text-sm font-medium text-[hsl(var(--foreground))]">{file.name}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-[hsl(var(--foreground))]">Click to choose a CSV file</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">or drag and drop</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4 text-center">
                  <CheckCircle2 className="w-5 h-5 mx-auto text-emerald-600 dark:text-emerald-400 mb-1" />
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{result.created}</p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">Created</p>
                </div>
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-center">
                  <AlertCircle className="w-5 h-5 mx-auto text-red-600 dark:text-red-400 mb-1" />
                  <p className="text-2xl font-bold text-red-700 dark:text-red-400">{result.failed}</p>
                  <p className="text-xs text-red-700 dark:text-red-400">Failed</p>
                </div>
                <div className="rounded-lg bg-[hsl(var(--muted))] border border-[hsl(var(--border))] p-4 text-center">
                  <FileSpreadsheet className="w-5 h-5 mx-auto text-[hsl(var(--muted-foreground))] mb-1" />
                  <p className="text-2xl font-bold text-[hsl(var(--foreground))]">{result.total}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Total Rows</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-2">
                    Errors ({result.errors.length})
                  </h3>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-[hsl(var(--border))]">
                    <table className="w-full text-xs">
                      <thead className="bg-[hsl(var(--muted))] sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-[hsl(var(--foreground))]">Row</th>
                          <th className="px-3 py-2 text-left font-semibold text-[hsl(var(--foreground))]">Field</th>
                          <th className="px-3 py-2 text-left font-semibold text-[hsl(var(--foreground))]">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[hsl(var(--border))]">
                        {result.errors.map((err, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 font-mono text-[hsl(var(--muted-foreground))]">{err.row}</td>
                            <td className="px-3 py-2 font-mono text-[hsl(var(--muted-foreground))]">{err.field ?? '—'}</td>
                            <td className="px-3 py-2 text-red-600 dark:text-red-400">{err.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.created > 0 && result.failed === 0 && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>All products imported successfully! Closing in 2 seconds...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 px-6 py-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            className="px-4 py-2 text-sm rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:border-foreground transition-colors cursor-pointer disabled:opacity-50"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploading}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-brand-gold text-white font-medium hover:bg-brand-gold-dark hover:shadow-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Importing...' : 'Import Products'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
