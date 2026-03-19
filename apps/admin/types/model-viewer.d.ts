/* eslint-disable @typescript-eslint/no-empty-object-type */
import type React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          poster?: string;
          'camera-controls'?: boolean | string;
          'auto-rotate'?: boolean | string;
          ar?: boolean | string;
          'ar-modes'?: string;
          loading?: 'auto' | 'lazy' | 'eager';
          'shadow-intensity'?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
