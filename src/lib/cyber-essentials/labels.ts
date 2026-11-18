import type { CeCloudModel, CeDeviceClass, CeImplementer } from './types';

export const DEVICE_CLASS_LABEL: Record<CeDeviceClass, string> = {
  boundary_firewall: 'boundary firewalls',
  router: 'routers',
  server: 'servers',
  desktop: 'desktop computers',
  laptop: 'laptops',
  tablet: 'tablets',
  mobile_phone: 'mobile phones',
  thin_client: 'thin clients',
  iaas: 'IaaS',
  paas: 'PaaS',
  saas: 'SaaS'
};

export const CLOUD_MODEL_LABEL: Record<CeCloudModel, string> = {
  iaas: 'Infrastructure as a service',
  paas: 'Platform as a service',
  saas: 'Software as a service'
};

export const IMPLEMENTER_LABEL: Record<CeImplementer, string> = {
  organisation: 'You',
  provider: 'The provider',
  both: 'You and the provider',
  provider_and_sometimes_organisation: 'The provider, sometimes with you'
};
