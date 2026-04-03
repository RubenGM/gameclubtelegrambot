export type IntegrationStatus = 'not-configured';

export interface AppRuntimeStatus {
  service: 'gameclubtelegrambot';
  infrastructure: {
    database: IntegrationStatus;
  };
  telegram: {
    bot: IntegrationStatus;
  };
}
