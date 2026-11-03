import { readFile, writeFile } from "node:fs/promises";
import { etiquetaPeriodo } from "./tarjetas.js";

// ==========================================================================
// datos.js - lee y guarda todo el estado en un archivo JSON.
//
// - semilla.json: datos de ejemplo, versionados en git. Guarda "diasAtras",
//   "diaDelMes" y "mesesAtras" en vez de fechas para que el ejemplo nunca
//   quede viejo.
// - patrimonio.json: el archivo que se lee y se escribe de verdad. No se
//   versiona: si no existe, se crea a partir de la semilla al arrancar.
//
// Todo vive en un solo archivo, así una acción que cambia varias partes
// (un movimiento, el disponible y un objetivo) se guarda en una sola
// escritura.
// ==========================================================================

// new URL(..., import.meta.url) arma la ruta desde la carpeta de este
// archivo, no desde donde se ejecutó "npm run dev".
const ARCHIVO_DATOS = new URL("../data/patrimonio.json", import.meta.url);
const ARCHIVO_SEMILLA = new URL("../data/semilla.json", import.meta.url);

const UN_DIA = 24 * 60 * 60 * 1000;

// Pasa la semilla a datos reales, contando desde hoy, para que el ejemplo
// sea siempre coherente con la fecha en que se arranca el servidor:
// - períodos de tarjeta: "mesesAtras" -> { mes, anio } (0 = este mes, el
//   período abierto; 1 = el mes pasado, el ya pagado).
// - movimientos: "diasAtras" -> fecha. El pago de la tarjeta usa en cambio
//   "diaDelMes" (se paga en este mes, después de cerrar el período anterior)
//   y su categoría se arma como la de un pago real: "Pago Visa - Octubre 2026".
// Al final los movimientos se ordenan del más nuevo al más viejo, que es el
// orden en que la app los guarda (cada movimiento nuevo va adelante).
function convertirSemilla(semilla) {
  const hoy = new Date();

  const tarjetas = semilla.tarjetas.map((tarjeta) => ({
    ...tarjeta,
    periodos: tarjeta.periodos.map(({ mesesAtras, ...periodo }) => {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - mesesAtras, 1);
      return { ...periodo, mes: fecha.getMonth(), anio: fecha.getFullYear() };
    }),
  }));

  const movimientos = semilla.movimientos.map(({ diasAtras, diaDelMes, ...mov }) => {
    if (mov.tipo === "tarjeta-pago") {
      const tarjeta = tarjetas.find((t) => t.id === mov.tarjetaId);
      const periodo = tarjeta.periodos.find((p) => p.id === mov.periodoId);
      return {
        ...mov,
        categoria: `Pago ${tarjeta.nombre} - ${etiquetaPeriodo(periodo)}`,
        fecha: new Date(hoy.getFullYear(), hoy.getMonth(), diaDelMes).toISOString(),
      };
    }
    return { ...mov, fecha: new Date(hoy.getTime() - diasAtras * UN_DIA).toISOString() };
  });
  // sort mantiene el orden original entre movimientos con la misma fecha.
  movimientos.sort((a, b) => b.fecha.localeCompare(a.fecha));

  return { ...semilla, tarjetas, movimientos };
}

// Se llama una vez al arrancar el servidor.
export async function inicializarDatos() {
  try {
    await readFile(ARCHIVO_DATOS, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error; // ENOENT = el archivo no existe
    const semilla = JSON.parse(await readFile(ARCHIVO_SEMILLA, "utf8"));
    await guardarDatos(convertirSemilla(semilla));
    console.log("Se creó data/patrimonio.json a partir de la semilla.");
  }
}

export async function leerDatos() {
  const texto = await readFile(ARCHIVO_DATOS, "utf8");
  return JSON.parse(texto);
}

export async function guardarDatos(datos) {
  await writeFile(ARCHIVO_DATOS, JSON.stringify(datos, null, 2) + "\n", "utf8");
}

// Todas las escrituras pasan por acá: lee el archivo, aplica "cambiar" y
// guarda UNA sola vez. Si "cambiar" lanza un error (una regla que no se
// cumple), no se guarda nada.
// Las operaciones se hacen de a una, en fila: si llegan dos pedidos juntos
// (un doble clic), el segundo espera al primero y ninguno pisa al otro.
let fila = Promise.resolve();

export function modificarDatos(cambiar) {
  const operacion = fila.then(async () => {
    const datos = await leerDatos();
    const resultado = cambiar(datos);
    await guardarDatos(datos);
    return resultado;
  });
  // Si esta operación falla, la fila sigue para las que vienen después.
  fila = operacion.catch(() => {});
  return operacion;
}
