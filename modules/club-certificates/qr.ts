import QRCode from "qrcode";
import { siteBaseUrl } from "@/modules/calendar/subscribe";

/** The address a certificate's QR code opens: the public check page for its verification number (stored form, no dash). */
export function certificateVerifyUrl(code: string): string {
  return `${siteBaseUrl()}/verify/${code}`;
}

/** The site's host for the "Check it at" line on paper. */
export function certificateVerifyHost(): string {
  return new URL(siteBaseUrl()).host;
}

export type CertificateQr = { size: number; path: string };

/** A QR code as one SVG path of dark squares on a `size` by `size` grid (no quiet zone; the page leaves its own margin). */
export function certificateQr(text: string): CertificateQr {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = modules.size;
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, path };
}
