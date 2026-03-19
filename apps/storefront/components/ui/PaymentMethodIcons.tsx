// Inline SVG brand icons for payment methods accepted by Naro Fashion
// Keys match the `accepted_payment_methods` CMS setting (comma-separated)

type IconProps = { className?: string };

const VisaIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#1A1F71" />
    <text x="20" y="20" textAnchor="middle" fill="white" fontSize="14" fontWeight="900" fontFamily="Arial,sans-serif" letterSpacing="-1">VISA</text>
  </svg>
);

const MastercardIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#252525" />
    <circle cx="15" cy="14" r="8" fill="#EB001B" />
    <circle cx="25" cy="14" r="8" fill="#F79E1B" />
    <path d="M20 7.5 Q23 11 23 14 Q23 17 20 20.5 Q17 17 17 14 Q17 11 20 7.5Z" fill="#FF5F00" />
  </svg>
);

const MpesaIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#E21B1B" />
    <rect x="3" y="5" width="14" height="18" rx="3" fill="white" />
    <rect x="5" y="7" width="10" height="12" rx="1" fill="#E21B1B" />
    <circle cx="8" cy="21" r="1" fill="#ccc" />
    <text x="29" y="12" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" fontFamily="Arial,sans-serif">M-</text>
    <text x="29" y="21" textAnchor="middle" fill="#4ADE80" fontSize="7" fontWeight="bold" fontFamily="Arial,sans-serif">PESA</text>
  </svg>
);

const TigoPesaIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#003087" />
    <rect x="3" y="5" width="14" height="18" rx="3" fill="white" />
    <rect x="5" y="7" width="10" height="12" rx="1" fill="#003087" />
    <circle cx="8" cy="21" r="1" fill="#ccc" />
    <text x="29" y="12" textAnchor="middle" fill="white" fontSize="6" fontWeight="bold" fontFamily="Arial,sans-serif">Tigo</text>
    <text x="29" y="21" textAnchor="middle" fill="#FFD700" fontSize="5.5" fontWeight="bold" fontFamily="Arial,sans-serif">PESA</text>
  </svg>
);

const AirtelIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#111111" />
    <path d="M6 18 Q7 8 12 6 Q16 4 14 12 Q12 18 8 19 Z" fill="#ED1C24" />
    <path d="M8 20 Q14 18 16 10 Q18 4 14 4" stroke="#ED1C24" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    <text x="28" y="13" textAnchor="middle" fill="#ED1C24" fontSize="6" fontWeight="bold" fontFamily="Arial,sans-serif">airtel</text>
    <text x="28" y="21" textAnchor="middle" fill="#ED1C24" fontSize="5.5" fontFamily="Arial,sans-serif">money</text>
  </svg>
);

const SelcomIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#1A1A1A" />
    <rect x="10" y="4" width="20" height="20" rx="5" stroke="white" strokeWidth="1.8" fill="none" />
    <path d="M22 7.5 Q25.5 7.5 25.5 11 L25.5 12 Q25.5 14 23 14 L17 14 Q14.5 14 14.5 16 L14.5 17 Q14.5 20.5 18 20.5" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" />
  </svg>
);

const HalotelIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 40 28" className={className} fill="none">
    <rect width="40" height="28" rx="4" fill="#006400" />
    <text x="20" y="12" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="Arial,sans-serif">HALOTEL</text>
    <text x="20" y="22" textAnchor="middle" fill="#FFD700" fontSize="6" fontFamily="Arial,sans-serif">HALOPESA</text>
  </svg>
);

const ICONS: Record<string, React.FC<IconProps>> = {
  VISA: VisaIcon,
  MASTERCARD: MastercardIcon,
  MPESA: MpesaIcon,
  TIGOPESA: TigoPesaIcon,
  AIRTEL: AirtelIcon,
  SELCOM: SelcomIcon,
  HALOTEL: HalotelIcon,
};

interface PaymentMethodIconsProps {
  methods: string[];
  className?: string;
}

export default function PaymentMethodIcons({ methods, className = 'w-10 h-7' }: PaymentMethodIconsProps) {
  return (
    <>
      {methods.map((method) => {
        const Icon = ICONS[method.toUpperCase()];
        if (!Icon) return null;
        return <Icon key={method} className={className} />;
      })}
    </>
  );
}
