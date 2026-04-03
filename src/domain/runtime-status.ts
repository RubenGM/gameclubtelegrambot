export type IntegrationStatus = 'connected' | 'not-configured';

export interface AppRuntimeStatus {
  service: 'gameclubtelegrambot';
  infrastructure: {
    database: IntegrationStatus;
  };
  telegram: {
    bot: IntegrationStatus;
  };
}
