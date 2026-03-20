import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          poster?: string;
          "camera-controls"?: boolean | string;
          "auto-rotate"?: boolean | string;
          ar?: boolean | string;
          "ar-modes"?: string;
          loading?: "auto" | "lazy" | "eager";
          style?: React.CSSProperties;
          "shadow-intensity"?: string;
          "environment-image"?: string;
          exposure?: string;
        },
        HTMLElement
      >;
    }
  }
}
