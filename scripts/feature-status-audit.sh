#!/usr/bin/env bash
set -euo pipefail

DOC_PATH="docs/feature-status.md"

if [ ! -f "$DOC_PATH" ]; then
  echo "❌ No existe $DOC_PATH"
  exit 1
fi

echo "# Revisión de inventario de features"
echo
echo "Archivo: $DOC_PATH"
echo
echo "Checklist obligatoria antes de cerrar un cambio funcional:"
echo "- Revisar qué módulos de Telegram se tocaron (por ejemplo: membership, schedule, catalog, storage, lfg, compras, news, ops)."
echo "- Actualizar índice de features y estado (operativo/parcial/pendiente/técnico)."
echo "- Añadir o ajustar riesgos y observaciones cuando cambie comportamiento visible."
echo "- Actualizar tabla de tests por área si se agrega o quita capacidad verificable."
echo "- Verificar que las rutas de ayuda/menus/permissions de la feature estén alineadas con docs."
echo
echo "Comandos recomendados tras revisar cambios:"
echo "- ./startup.sh (validación real en despliegue/lifecycle local)"
echo "- ./scripts/service-journal.sh (depuración en runtime)"
echo
echo "Estado actual del documento:"
echo
if command -v rg >/dev/null 2>&1; then
  rg -n "Estado|operativo|parcial|pendiente|técnico|Resumen ejecutivo|Pendientes transversales" "$DOC_PATH" | head -n 30
else
  grep -n "Estado\|operativo\|parcial\|pendiente\|técnico\|Resumen ejecutivo\|Pendientes transversales" "$DOC_PATH" | head -n 30
fi
