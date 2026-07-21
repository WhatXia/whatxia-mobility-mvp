export type Driver = {
  id: string;
  name: string;
  phone: string;
  plate: string;
  available: boolean;
};

/**
 * Conductores de prueba en memoria.
 * Reemplaza los teléfonos por números reales de WhatsApp (con código de país, sin +).
 */
export const drivers: Driver[] = [
  {
    id: "drv_1",
    name: "Carlos Pérez",
    phone: "573000000001",
    plate: "ABC123",
    available: true,
  },
  {
    id: "drv_2",
    name: "María López",
    phone: "573000000002",
    plate: "XYZ789",
    available: true,
  },
];

export function getAvailableDrivers(): Driver[] {
  return drivers.filter((driver) => driver.available);
}
