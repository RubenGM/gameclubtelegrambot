export interface InfrastructureBoundaryStatus {
  database: 'not-configured';
}

export function createInfrastructureBoundary(): InfrastructureBoundaryStatus {
  return {
    database: 'not-configured',
  };
}
