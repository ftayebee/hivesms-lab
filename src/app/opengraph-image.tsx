import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";

export const alt = `${siteConfig.name}: SMS platform for Bangladesh`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0E1A36", color: "#E7ECF6", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#1E3FA8", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 12px", gap: 8 }}>
            <div style={{ height: 5, width: 32, background: "#fff", borderRadius: 4 }} />
            <div style={{ height: 5, width: 20, background: "#fff", borderRadius: 4 }} />
          </div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>{siteConfig.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.08, maxWidth: 950 }}>Bulk SMS, OTP and SMS API for Bangladesh</div>
          <div style={{ fontSize: 30, marginTop: 24, color: "#95A2BE" }}>Delivery reports · BDT billing · Developer-friendly REST API</div>
        </div>
        <div style={{ display: "flex", height: 8, width: 240, background: "#2CC7B8", borderRadius: 8 }} />
      </div>
    ),
    size,
  );
}
