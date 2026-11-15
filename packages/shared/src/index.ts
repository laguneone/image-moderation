export type ServiceStatus = 'ok';

export interface HealthResponse {
  status: ServiceStatus;
  service: 'api';
}
