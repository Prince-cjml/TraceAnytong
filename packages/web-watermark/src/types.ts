export interface ScreenTileOptions {
  traceHandle: string;
  profileVersion: string;
  scope: "issuance" | "web_session";
  strength?: number;
  size?: number;
}

export interface ForensicWatermarkLayerProps {
  /** Authorized, session-specific tile URL. */
  tileUrl: string;
  routeScope: string;
  opacity?: number;
  className?: string;
}
