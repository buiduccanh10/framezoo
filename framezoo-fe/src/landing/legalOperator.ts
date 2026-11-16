export interface LegalOperatorConfig {
  operatorName: string;
  operatorAddress: string;
  contactEmail: string;
  legalRoutingEmail: string;
  privacyRoutingEmail: string;
  phone: string;
}

const env =
  typeof import.meta !== "undefined" && import.meta.env
    ? (import.meta.env as Record<string, string | undefined>)
    : {};

export const LEGAL_OPERATOR: LegalOperatorConfig = {
  operatorName:
    env.VITE_LEGAL_OPERATOR_NAME?.trim() ||
    "Bùi Đức Cảnh (Nhà phát triển độc lập dự án Framezoo)",
  operatorAddress:
    env.VITE_LEGAL_OPERATOR_ADDRESS?.trim() ||
    "Pháo Đài Láng, P. Láng, Thành phố Hà Nội, Việt Nam",
  contactEmail: env.VITE_LEGAL_EMAIL?.trim() || "framezoo.top@gmail.com",
  legalRoutingEmail: "legal@framezoo.top",
  privacyRoutingEmail: "privacy@framezoo.top",
  phone: env.VITE_LEGAL_PHONE?.trim() || "0984908816",
};
