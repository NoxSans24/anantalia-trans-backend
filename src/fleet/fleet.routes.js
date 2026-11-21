import express from 'express';
import { createFleetController } from './fleet.controller.js';

export function createPublicFleetRouter({ fleetService, logger } = {}) {
  const controller = createFleetController({ fleetService, logger });
  const router = express.Router();
  router.get('/rental-types', controller.publicRentalTypes);
  router.get('/vehicle-categories', controller.publicCategories);
  router.get('/vehicle-models', controller.publicModels);
  router.get('/vehicle-models/:idOrSlug', controller.publicModelDetail);
  router.get('/fleet-catalog', controller.publicCatalog);
  router.get('/vehicle-media/:mediaId', controller.publicModelMedia);
  return router;
}

export function createAdminFleetRouter({ fleetService, logger } = {}) {
  const controller = createFleetController({ fleetService, logger });
  const router = express.Router();
  router.get('/vehicle-categories', controller.listCategories);
  router.post('/vehicle-categories', controller.createCategory);
  router.get('/vehicle-categories/:id', controller.getCategory);
  router.patch('/vehicle-categories/:id', controller.updateCategory);
  router.delete('/vehicle-categories/:id', controller.deactivateCategory);
  router.get('/vehicle-models', controller.listModels);
  router.post('/vehicle-models', controller.createModel);
  router.post('/vehicle-models/upload-image', controller.uploadModelImage);
  router.get('/vehicle-models/:id', controller.getModel);
  router.patch('/vehicle-models/:id', controller.updateModel);
  router.delete('/vehicle-models/:id', controller.deactivateModel);
  router.get('/vehicle-models/:id/rental-options', controller.listRentalOptions);
  router.put('/vehicle-models/:id/rental-options/:rentalType', controller.setRentalOption);
  router.get('/vehicle-units', controller.listVehicleUnits);
  router.get('/vehicle-units/:id', controller.getVehicleUnit);
  router.post('/vehicle-units', controller.createVehicleUnit);
  router.patch('/vehicle-units/:id', controller.updateVehicleUnit);
  router.delete('/vehicle-units/:id', controller.deleteVehicleUnit);
  router.get('/vehicle-units/:id/maintenances', controller.listUnitMaintenances);
  router.post('/vehicle-units/:id/maintenances', controller.createUnitMaintenance);
  router.patch('/vehicle-units/:id/maintenances/:maintenanceId', controller.updateUnitMaintenance);
  return router;
}
