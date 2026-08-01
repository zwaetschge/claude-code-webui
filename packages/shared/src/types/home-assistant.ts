export type HomeAssistantStatus = 'success' | 'problem' | 'question';

export interface HomeAssistantIntegrationSettings {
  enabled: boolean;
  configured: boolean;
  baseUrl: string;
  baseUrlFromEnv: boolean;
  accessTokenConfigured: boolean;
  accessTokenFromEnv: boolean;
}

export interface HomeAssistantIntegrationSettingsUpdate {
  enabled?: boolean;
  baseUrl?: string;
  accessToken?: string;
  clearAccessToken?: boolean;
}

export interface HomeAssistantConnectionTest {
  connected: boolean;
  version: string | null;
  locationName: string | null;
  lightCount: number;
}

export interface HomeAssistantLightEntity {
  entityId: string;
  name: string;
  state: string;
  available: boolean;
  colorCapable: boolean;
  supportedColorModes: string[];
}
