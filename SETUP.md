# Mis Finanzas — guía de despliegue

Stack: **Next.js 16 + Supabase (Postgres + Auth) + Vercel**. Tiempo estimado: 20–30 minutos.

---

## 1. Supabase — base de datos

1. Entrá a <https://supabase.com/dashboard> → **New project**.
   - Región: **South America (São Paulo)** (la más cercana a Argentina).
   - Guardá la contraseña de la base en tu gestor de contraseñas.
2. Cuando termine de crearse: **SQL Editor → New query**, pegá el contenido completo de `supabase/schema.sql` y ejecutá **Run**.
   - Tiene que terminar sin errores. Se puede volver a correr sin perder datos.
3. Verificá en **Table Editor** que existan: `accounts`, `categories`, `transactions`, `budgets`, `recurring`, `audit_log`, y que todas muestren **RLS enabled**.
4. Opcional: **Advisors → Security Advisor** no debería marcar tablas sin RLS.

### Migraciones (si ya tenías la base creada)

Si ya corriste `schema.sql` antes, ejecutá solo las migraciones nuevas, en orden, en el SQL Editor:

| Archivo | Para qué |
|---|---|
| `supabase/migrations/002_comercios.sql` | El escáner recuerda comercio y categoría |
| `supabase/migrations/003_cuotas.sql` | Resúmenes de tarjeta y cuotas |

Son idempotentes: correrlas dos veces no rompe nada.

## 2. Supabase — autenticación (solo vos)

1. **Authentication → Sign In / Providers**:
   - **Email**: habilitado.
   - **Allow new users to sign up**: **DESHABILITADO**. Así nadie más puede registrarse.
2. **Authentication → Users → Add user → Create new user**:
   - Tu email y una contraseña fuerte (usá el gestor).
   - Marcá **Auto Confirm User**.
3. **Authentication → URL Configuration → Site URL**: poné la URL de Vercel (después del paso 4, por ejemplo `https://mis-finanzas-xxx.vercel.app`).

> Las categorías (tus 5 de gasto + subcategorías, Sueldo, Otros ingresos) y 3 cuentas (Efectivo, Banco, Tarjeta) se crean solas la primera vez que entrás.

## 3. Claves de la API

**Project Settings → API Keys** (o **Data API**):

| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | La clave **anon** (legacy) o la **publishable** (`sb_publishable_…`). Cualquiera de las dos sirve. |

⚠️ **Nunca** uses la `service_role` / `secret` key. Esa clave ignora el RLS y esta app no la necesita en ningún lado.

## 4. GitHub + Vercel

```bash
cd mis-finanzas
git init
git add .
git commit -m "Mis Finanzas v1"
git branch -M main
git remote add origin https://github.com/gekieper-cell/mis-finanzas.git   # creá el repo PRIVADO antes
git push -u origin main
```

En <https://vercel.com/new>:

1. **Import** del repo `mis-finanzas`. Framework: Next.js (lo detecta solo).
2. **Environment Variables**: cargá las 2 variables del paso 3 para Production, Preview y Development.
3. **Deploy**.
4. Copiá la URL final y volvé al paso 2.3 (Site URL).

`.env.local` está en `.gitignore`: las claves nunca van al repo.

## 5. Instalar como app en el celular

- **Android (Chrome)**: abrí la URL → menú ⋮ → **Instalar app** / **Agregar a pantalla principal**.
- **iPhone (Safari)**: abrí la URL → botón **Compartir** → **Agregar a inicio**.

Queda con ícono propio y se abre a pantalla completa, sin barra del navegador.

## 6. Desarrollo local (opcional)

```bash
cp .env.example .env.local     # completá las 2 variables
npm install
npm run dev                    # http://localhost:3000
```

---

## Cómo funciona

| Sección | Qué hace |
|---|---|
| **Resumen** | Saldo total, ingresos, gastos y ahorro del mes con variación contra el mes anterior. Dona de gastos por categoría, alertas de presupuesto (80% / 100%), barras de 6 meses, próximos vencimientos y últimos movimientos. |
| **Botón +** | Carga rápida: monto, categoría con un toque, subcategoría opcional. Recuerda la última cuenta usada. Acepta montos como `1.890.000` o `45.500,50`. |
| **Movimientos** | Por mes o por año, agrupados por día. Búsqueda y filtros (tipo, cuenta, categoría). Tocá uno para editarlo o borrarlo. Exporta e importa CSV. |
| **Presupuestos** | Límite mensual por categoría (se guarda al salir del campo). Alta y edición de categorías, subcategorías, colores e íconos. |
| **Cuentas** | Saldos por cuenta, patrimonio neto, deudas. Transferencias entre cuentas. Archivar oculta la cuenta sin borrar datos. |
| **Recurrentes** | Gastos fijos, ingresos fijos y suscripciones con costo mensual y anual. Los **automáticos** se registran solos cuando vence la fecha (al abrir la app). Los manuales tienen el botón **Registrar**. Los mensuales respetan el día: si es el 31, en febrero cae el 28. |
| **Actividad** | Historial de cada alta, cambio o baja, con valor anterior y nuevo. Lo escribe un trigger de la base: desde la app no se puede editar ni borrar. |

## Seguridad implementada

- **RLS** en todas las tablas: `user_id = auth.uid()` para lectura y escritura.
- **Claves foráneas compuestas** `(id, user_id)`: aunque alguien conozca el UUID de un registro ajeno, no puede referenciarlo.
- La vista de saldos es `security_invoker`, así que respeta el RLS.
- Funciones con `search_path = ''`. Solo el trigger de auditoría es `SECURITY DEFINER`, y no se puede ejecutar directamente.
- El rol `anon` no tiene permisos sobre las tablas. El registro público está deshabilitado (paso 2).
- El proxy valida la sesión contra Supabase Auth con `getUser()` en cada request, y el layout lo vuelve a validar en el servidor.
- Headers: CSP estricta (solo conecta con tu proyecto de Supabase), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y `noindex`.
- El login devuelve un mensaje de error genérico, sin revelar si el email existe.
- El CSV exportado neutraliza fórmulas (protección contra CSV injection).
- Probado: un usuario autenticado no puede leer, escribir ni referenciar datos de otro. Tampoco puede escribir ni borrar la auditoría, y `anon` no accede a nada.

**Recomendado en Supabase**: Authentication → Policies/Settings → largo mínimo de contraseña 12. Si tu plan lo incluye, activá *Leaked password protection*.

## Migrar datos de la app anterior

La app anterior guardaba todo en el `localStorage` del navegador, que está atado a su dominio. La nueva app no puede leerlo directamente. Opciones:

1. **CSV**: armá una planilla con las columnas `fecha;tipo;monto;categoria;subcategoria;cuenta;cuenta_destino;nota` e importala desde **Movimientos → Importar**.
2. **Volcado**: abrí la app vieja en la PC, apretá F12 → Console, ejecutá `copy(JSON.stringify(localStorage))` y pegá el resultado en un archivo. Con eso se puede generar el CSV.
