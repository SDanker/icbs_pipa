# iCBS PIPA - Panel de Estados

Este sitio entrega una vista rápida del estado operativo de los carros y sus
ubicaciones, junto con paneles de resumen por tipo y distribución por cuartel.

## ¿Qué hace la página?

- **Dashboard principal:** muestra los carros agrupados por tipo y su estado
  operativo (en servicio, en llamado, disponible, fuera de servicio).
- **Otros cuerpos:** vista filtrada para vehículos de otros cuerpos.
- **Resumen por tipo:** conteo de estados por categoría de carro.
- **Carros por cuartel:** distribución de carros por cuartel, con la
  Comandancia identificada en el cuartel 23.
- **Service:** menú de acceso rápido a los paneles.

## Datos que utiliza

- **/api/carros:** consulta la base de datos para obtener estado, ubicación y
  conductor.
- **/data/cuarteles.csv:** asigna cada carro a su cuartel para la vista por
  cuartel.

## Navegación rápida

- `/dashboard` — Dashboard principal.
- `/otros-cuerpos` — Otros cuerpos.
- `/dashboard/resumen` — Resumen por tipo.
- `/dashboard/cuartel` — Carros por cuartel.
- `/` — Menú de acceso.
