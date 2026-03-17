import { useEffect, useRef, useCallback } from 'react';

/**
 * Global barcode scanner hook.
 *
 * USB/Bluetooth barcode scanners act as HID keyboard devices — they rapidly
 * "type" characters (typically <50ms between keystrokes) and press Enter.
 *
 * This hook listens globally for rapid keystroke sequences followed by Enter,
 * distinguishing scanner input from normal typing by speed threshold.
 *
 * Best practices (Square, Shopify POS, Lightspeed, Vend):
 * - Always listening — works regardless of focused input
 * - Speed-based detection — scanners type 10-30x faster than humans
 * - Minimum length filter — barcodes are typically 4+ characters
 * - Prevents input bleed — stops scanned characters from appearing in text fields
 * - Configurable threshold — adjust for different scanner speeds
 */

interface UseBarcodeOptions {
  /** Called when a valid barcode scan is detected */
  onScan: (barcode: string) => void;
  /** Max milliseconds between keystrokes to count as scanner input (default: 50) */
  maxKeystrokeInterval?: number;
  /** Minimum barcode length to accept (default: 4) */
  minLength?: number;
  /** Whether the scanner hook is active (default: true) */
  enabled?: boolean;
}

export function useBarcodeScanner({
  onScan,
  maxKeystrokeInterval = 50,
  minLength = 4,
  enabled = true,
}: UseBarcodeOptions) {
  const bufferRef = useRef('');
  const lastKeystrokeRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetBuffer = useCallback(() => {
    bufferRef.current = '';
    lastKeystrokeRef.current = 0;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const target = e.target as HTMLElement;
      const isInTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Enter key — check if buffer looks like a barcode scan
      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        if (code.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          onScan(code);
          resetBuffer();
          return;
        }
        resetBuffer();
        return;
      }

      // Only accept printable single characters (not modifiers, arrows, etc.)
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) {
        // Reset on modifier keys — scanners don't use modifiers
        if (!['Shift'].includes(e.key)) {
          resetBuffer();
        }
        return;
      }

      const elapsed = now - lastKeystrokeRef.current;
      lastKeystrokeRef.current = now;

      // If too slow between keystrokes, reset and start fresh
      if (bufferRef.current.length > 0 && elapsed > maxKeystrokeInterval) {
        bufferRef.current = e.key;
      } else {
        bufferRef.current += e.key;
      }

      // If we're building a rapid sequence and in a text input, prevent the character
      // from appearing (scanner input shouldn't go into text fields)
      if (bufferRef.current.length >= 3 && isInTextInput) {
        e.preventDefault();
      }

      // Auto-clear buffer after idle period (scanner didn't finish with Enter)
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(resetBuffer, 200);
    };

    // Use capture phase to intercept before other handlers
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, maxKeystrokeInterval, minLength, onScan, resetBuffer]);

  return { resetBuffer };
}
